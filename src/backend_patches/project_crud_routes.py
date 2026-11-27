"""Project, lot, stage workflow, checklist, and resource deletion routes.

project-crud-routes-v1
"""
from __future__ import annotations

from datetime import date as _default_date, datetime as _default_datetime
from typing import Any

try:
    from sqlalchemy import text as _default_text
except Exception:  # pragma: no cover
    def _default_text(sql: str) -> str:
        return sql

try:
    from sqlalchemy.orm import joinedload as _default_joinedload, selectinload as _default_selectinload
except Exception:  # pragma: no cover
    def _default_joinedload(*args: Any, **kwargs: Any) -> Any:
        return None
    def _default_selectinload(*args: Any, **kwargs: Any) -> Any:
        return None

PROJECT_CRUD_ROUTES_SIGNATURE = "project-crud-routes-v1"


def _ctx(ctx: Any = None):
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context
    if ctx is None:
        return runtime_context.current_context(depth=2)
    return runtime_context.get_runtime_context(ctx)


def _load_recycle_bin():
    try:
        import recycle_bin
        return recycle_bin
    except ModuleNotFoundError:
        try:
            from . import recycle_bin
            return recycle_bin
        except ImportError:
            return None


def _wants_permanent_delete(ctx: Any) -> bool:
    req = ctx.get("request")
    if req is None:
        return False
    args = getattr(req, "args", None)
    if args is None:
        return False
    return str(args.get("permanent") or "").strip().lower() in ("1", "true", "yes")


def hard_delete_project_record(
    ctx: Any,
    project: Any,
    *,
    commit: bool = True,
    deferred_cleanups: list | None = None,
    exclude_recycle_id: int | None = None,
    actor_uid: int | None = None,
    now_iso: str | None = None,
) -> None:
    from types import SimpleNamespace
    ctx = _ctx(ctx)
    _cleanup_project_files = ctx.get("_cleanup_project_files")
    _delete_attachment_file = ctx.get("_delete_attachment_file")
    app = ctx.get("app")
    db = ctx.get("db")
    pid = project.id
    raw_attachments = list(project.attachments.all()) if hasattr(project.attachments, "all") else list(project.attachments or [])
    attachment_snaps = [
        SimpleNamespace(
            id=getattr(att, "id", None),
            file_path=getattr(att, "file_path", ""),
            filename=getattr(att, "filename", ""),
        )
        for att in raw_attachments
    ]

    def _run_cleanup():
        for attachment in attachment_snaps:
            try:
                if callable(_delete_attachment_file):
                    _delete_attachment_file(attachment)
            except Exception as error:
                if app is not None and getattr(app, "logger", None):
                    app.logger.warning(
                        f"删除项目附件物理文件失败: att_id={attachment.id}, {error}"
                    )
        try:
            if callable(_cleanup_project_files):
                _cleanup_project_files(pid)
        except Exception as error:
            if app is not None and getattr(app, "logger", None):
                app.logger.warning(f"清理已删除项目文件失败: project_id={pid}, {error}")

    try:
        if callable(getattr(db.session, 'execute', None)):
            try:
                import no_deposit_workflow
            except ModuleNotFoundError:
                from src.backend_patches import no_deposit_workflow
            no_deposit_workflow.cleanup_deleted_project(db, pid)
            purge_results = getattr(app, 'extensions', {}).get('special_result_purge')
            if purge_results:
                purge_results(pid)
            try:
                if __package__:
                    from . import notification_channels
                else:
                    import notification_channels
                notification_channels.cleanup_deleted_project_notifications(db, pid)
            except Exception:
                pass
            rb = _load_recycle_bin()
            if rb is not None and callable(getattr(rb, "close_out_hard_deleted_entities", None)):
                uid = actor_uid
                if uid is None and callable(getattr(rb, "_current_actor", None)):
                    try:
                        uid, _ = rb._current_actor(ctx)
                    except Exception:
                        uid = None
                rb.close_out_hard_deleted_entities(
                    db,
                    entity_type="project",
                    entity_id=pid,
                    project_id=pid,
                    child_attachment_ids=[a.id for a in attachment_snaps if a.id is not None],
                    actor_uid=uid,
                    now_iso=now_iso,
                    exclude_recycle_id=exclude_recycle_id,
                )
        db.session.delete(project)
        if commit:
            db.session.commit()
        else:
            db.session.flush()
    except Exception:
        if commit:
            db.session.rollback()
        raise
    if deferred_cleanups is not None:
        deferred_cleanups.append(_run_cleanup)
    else:
        _run_cleanup()


def hard_delete_attachment_record(
    ctx: Any,
    attachment: Any,
    *,
    commit: bool = True,
    deferred_cleanups: list | None = None,
    exclude_recycle_id: int | None = None,
    actor_uid: int | None = None,
    now_iso: str | None = None,
) -> tuple[str, int]:
    ctx = _ctx(ctx)
    UPLOAD_FOLDER = ctx.get("UPLOAD_FOLDER")
    _validate_file_path = ctx.get("_validate_file_path")
    app = ctx.get("app")
    db = ctx.get("db")
    file_path, filename, project_id, att_id = (
        attachment.file_path,
        attachment.filename,
        attachment.project_id,
        attachment.id,
    )
    file_full_path = UPLOAD_FOLDER / file_path
    _validate_file_path(file_full_path, file_path)

    def _run_cleanup():
        try:
            if file_full_path.exists():
                file_full_path.unlink()
            elif app is not None and getattr(app, "logger", None):
                app.logger.warning(f"文件不存在，跳过物理删除: aid={att_id}")
        except Exception as error:
            if app is not None and getattr(app, "logger", None):
                app.logger.warning(f"删除文件失败: {error}")

    try:
        rb = _load_recycle_bin()
        if rb is not None and callable(getattr(rb, "close_out_hard_deleted_entities", None)):
            uid = actor_uid
            if uid is None and callable(getattr(rb, "_current_actor", None)):
                try:
                    uid, _ = rb._current_actor(ctx)
                except Exception:
                    uid = None
            rb.close_out_hard_deleted_entities(
                db,
                entity_type="attachment",
                entity_id=att_id,
                project_id=project_id,
                actor_uid=uid,
                now_iso=now_iso,
                exclude_recycle_id=exclude_recycle_id,
            )
        db.session.delete(attachment)
        if commit:
            db.session.commit()
        else:
            db.session.flush()
    except Exception:
        if commit:
            db.session.rollback()
        raise
    if deferred_cleanups is not None:
        deferred_cleanups.append(_run_cleanup)
    else:
        _run_cleanup()
    return filename, project_id


def hard_delete_complaint_record(
    ctx: Any,
    complaint: Any,
    *,
    commit: bool = True,
    deferred_cleanups: list | None = None,
    exclude_recycle_id: int | None = None,
    actor_uid: int | None = None,
    now_iso: str | None = None,
) -> None:
    ctx = _ctx(ctx)
    UPLOAD_FOLDER = ctx.get("UPLOAD_FOLDER")
    _validate_file_path = ctx.get("_validate_file_path")
    app = ctx.get("app")
    db = ctx.get("db")
    Attachment = ctx.get("Attachment")
    text = ctx.get("text", _default_text)
    cid = complaint.id
    pid = getattr(complaint, "project_id", None)
    owned_attachments = []
    seen_att_ids: set[int] = set()
    for attachment in list(getattr(complaint, "attachments", None) or ()):
        aid = getattr(attachment, "id", None)
        if aid is None or aid not in seen_att_ids:
            if aid is not None:
                seen_att_ids.add(aid)
            owned_attachments.append(attachment)
    for event in list(getattr(complaint, "events", None) or ()):
        for attachment in list(getattr(event, "attachments", None) or ()):
            aid = getattr(attachment, "id", None)
            if aid is None or aid not in seen_att_ids:
                if aid is not None:
                    seen_att_ids.add(aid)
                owned_attachments.append(attachment)
    if Attachment is not None and callable(getattr(db.session, "execute", None)):
        try:
            sql_aids = [
                int(r[0])
                for r in db.session.execute(
                    text(
                        "SELECT a.id FROM attachments a "
                        "LEFT JOIN complaint_events ce ON ce.id = a.complaint_event_id "
                        "WHERE a.complaint_id=:cid OR ce.complaint_id=:cid"
                    ),
                    {"cid": int(cid)},
                ).fetchall()
                if r[0] is not None
            ]
            for aid in sql_aids:
                if aid not in seen_att_ids:
                    extra_att = db.session.get(Attachment, aid)
                    seen_att_ids.add(aid)
                    if extra_att is not None:
                        owned_attachments.append(extra_att)
        except Exception:
            pass
    paths = [(getattr(attachment, "id", None), attachment.file_path) for attachment in owned_attachments if getattr(attachment, "file_path", None)]
    legacy_path = getattr(complaint, "attachment_path", None)
    if legacy_path:
        paths.append((None, legacy_path))

    def _run_cleanup():
        for attachment_id, relative_path in paths:
            try:
                path = UPLOAD_FOLDER / relative_path
                _validate_file_path(path, relative_path)
                if path.exists():
                    path.unlink()
            except Exception as error:
                if app is not None and getattr(app, "logger", None):
                    app.logger.warning(f"删除质疑附件物理文件失败: att_id={attachment_id}, {error}")

    try:
        # Pure-source ORM keeps Attachment.complaint_id / complaint_event_id non-cascading;
        # explicitly delete owned attachment rows and close out all matching recycle entries in the same transaction.
        rb = _load_recycle_bin()
        if rb is not None and callable(getattr(rb, "close_out_hard_deleted_entities", None)):
            uid = actor_uid
            if uid is None and callable(getattr(rb, "_current_actor", None)):
                try:
                    uid, _ = rb._current_actor(ctx)
                except Exception:
                    uid = None
            rb.close_out_hard_deleted_entities(
                db,
                entity_type="complaint",
                entity_id=cid,
                project_id=pid,
                child_attachment_ids=seen_att_ids,
                actor_uid=uid,
                now_iso=now_iso,
                exclude_recycle_id=exclude_recycle_id,
            )
        for attachment in owned_attachments:
            db.session.delete(attachment)
        db.session.delete(complaint)
        if commit:
            db.session.commit()
        else:
            db.session.flush()
    except Exception:
        if commit:
            db.session.rollback()
        raise
    if deferred_cleanups is not None:
        deferred_cleanups.append(_run_cleanup)
    else:
        _run_cleanup()


def hard_delete_clarification_record(
    ctx: Any,
    item: Any,
    fallback: Any = None,
    recalculate_fn: Any = None,
    *,
    commit: bool = True,
    deferred_cleanups: list | None = None,
    exclude_recycle_id: int | None = None,
    actor_uid: int | None = None,
    now_iso: str | None = None,
) -> None:
    from types import SimpleNamespace
    ctx = _ctx(ctx)
    _delete_attachment_file = ctx.get("_delete_attachment_file")
    _recalculate_clarification_deadline = recalculate_fn or ctx.get(
        "_recalculate_clarification_deadline",
        lambda proj, fb=None: recalculate_clarification_deadline(ctx, proj, fb),
    )
    app = ctx.get("app")
    db = ctx.get("db")
    Attachment = ctx.get("Attachment")
    text = ctx.get("text", _default_text)
    clid = item.id
    pid = getattr(item, "project_id", None)
    attachments = list(getattr(item, "attachments", None) or ())
    seen_att_ids = {getattr(att, "id", None) for att in attachments if getattr(att, "id", None) is not None}
    if Attachment is not None and callable(getattr(db.session, "execute", None)):
        try:
            for (aid,) in db.session.execute(
                text("SELECT id FROM attachments WHERE clarification_id=:clid"),
                {"clid": int(clid)},
            ).fetchall():
                if aid is not None and int(aid) not in seen_att_ids:
                    extra_att = db.session.get(Attachment, int(aid))
                    seen_att_ids.add(int(aid))
                    if extra_att is not None:
                        attachments.append(extra_att)
        except Exception:
            pass
    attachment_snaps = [
        SimpleNamespace(
            id=getattr(att, "id", None),
            file_path=getattr(att, "file_path", ""),
            filename=getattr(att, "filename", ""),
        )
        for att in attachments
    ]
    project = item.project

    def _run_cleanup():
        for attachment in attachment_snaps:
            try:
                if callable(_delete_attachment_file):
                    _delete_attachment_file(attachment)
            except Exception as error:
                if app is not None and getattr(app, "logger", None):
                    app.logger.warning("删除澄清附件失败: %s", error)

    try:
        # Explicitly delete owned attachment rows & close out recycle entries inside the same transaction.
        rb = _load_recycle_bin()
        if rb is not None and callable(getattr(rb, "close_out_hard_deleted_entities", None)):
            uid = actor_uid
            if uid is None and callable(getattr(rb, "_current_actor", None)):
                try:
                    uid, _ = rb._current_actor(ctx)
                except Exception:
                    uid = None
            rb.close_out_hard_deleted_entities(
                db,
                entity_type="clarification",
                entity_id=clid,
                project_id=pid,
                child_attachment_ids=seen_att_ids,
                actor_uid=uid,
                now_iso=now_iso,
                exclude_recycle_id=exclude_recycle_id,
            )
        for attachment in attachments:
            db.session.delete(attachment)
        db.session.delete(item)
        db.session.flush()
        if project is not None:
            _recalculate_clarification_deadline(project, fallback)
        if commit:
            db.session.commit()
    except Exception:
        if commit:
            db.session.rollback()
        raise
    if deferred_cleanups is not None:
        deferred_cleanups.append(_run_cleanup)
    else:
        _run_cleanup()


def api_delete_project(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    project = db.get_or_404(Project, pid)
    rb = _load_recycle_bin()
    if rb is not None and rb.is_enabled(ctx):
        if _wants_permanent_delete(ctx):
            if not rb.can_permanent_delete(ctx, "project"):
                return jsonify({"error": "当前账号没有彻底删除此记录的权限"}), 403
        else:
            reason = rb._extract_delete_reason(ctx.get("request"))
            return jsonify(rb.soft_delete_project(ctx, project, reason=reason))
    hard_delete_project_record(ctx, project)
    return jsonify({"ok": True})


def api_delete_attachment(ctx: Any, aid: int):
    ctx = _ctx(ctx)
    Attachment = ctx.get("Attachment")
    app = ctx.get("app")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    try:
        attachment = Attachment.query.get(aid)
        if not attachment:
            return jsonify({"error": "附件不存在，可能已被删除"}), 404
        rb = _load_recycle_bin()
        if rb is not None and rb.is_enabled(ctx):
            if _wants_permanent_delete(ctx):
                if not rb.can_permanent_delete(ctx, "attachment"):
                    return jsonify({"error": "当前账号没有彻底删除此记录的权限"}), 403
            else:
                if rb.is_deleted(db, "attachment", aid):
                    return jsonify({"error": "附件已移入回收站"}), 404
                reason = rb._extract_delete_reason(ctx.get("request"))
                return jsonify(rb.soft_delete_attachment(ctx, attachment, reason=reason))
        filename, project_id = hard_delete_attachment_record(ctx, attachment)
    except Exception as error:
        db.session.rollback()
        app.logger.error(f"删除附件失败 aid={aid}: {error}")
        return jsonify({"error": "删除失败，请重试"}), 500
    try:
        log_operation("delete_attachment", "project", project_id, f"删除附件：{filename}")
    except Exception as error:
        app.logger.warning(f"附件删除日志写入失败: aid={aid}, {error}")
    return jsonify({"ok": True, "message": f"{filename} 已成功删除"})


def api_delete_complaint(ctx: Any, pid: int, cid: int):
    ctx = _ctx(ctx)
    Complaint = ctx.get("Complaint")
    _ensure_project_resource = ctx.get("_ensure_project_resource")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    complaint = _ensure_project_resource(db.get_or_404(Complaint, cid), pid)
    rb = _load_recycle_bin()
    if rb is not None and rb.is_enabled(ctx):
        if _wants_permanent_delete(ctx):
            if not rb.can_permanent_delete(ctx, "complaint"):
                return jsonify({"error": "仅管理员可彻底删除质疑/投诉记录"}), 403
        else:
            reason = rb._extract_delete_reason(ctx.get("request"))
            return jsonify(rb.soft_delete_complaint(ctx, complaint, reason=reason))
    hard_delete_complaint_record(ctx, complaint)
    return jsonify({"ok": True})


def api_update_delete_complaint_event(ctx: Any, pid: int, cid: int, eid: int):
    ctx = _ctx(ctx)
    Complaint = ctx.get("Complaint")
    ComplaintEvent = ctx.get("ComplaintEvent")
    UPLOAD_FOLDER = ctx.get("UPLOAD_FOLDER")
    _ensure_project_resource = ctx.get("_ensure_project_resource")
    _parse_optional_date = ctx.get("_parse_optional_date")
    _validate_file_path = ctx.get("_validate_file_path")
    app = ctx.get("app")
    datetime = ctx.get("datetime", _default_datetime)
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    request = ctx.get("request")
    complaint = _ensure_project_resource(db.get_or_404(Complaint, cid), pid)
    event = ComplaintEvent.query.filter_by(id=eid, complaint_id=complaint.id).first_or_404()
    if request.method == "DELETE":
        Attachment = ctx.get("Attachment")
        text = ctx.get("text", _default_text)
        event_attachments = list(event.attachments)
        seen_att_ids = {getattr(a, "id", None) for a in event_attachments if getattr(a, "id", None) is not None}
        if Attachment is not None and callable(getattr(db.session, "execute", None)):
            try:
                for (aid,) in db.session.execute(
                    text("SELECT id FROM attachments WHERE complaint_event_id=:eid"),
                    {"eid": int(event.id)},
                ).fetchall():
                    if aid is not None and int(aid) not in seen_att_ids:
                        extra_att = db.session.get(Attachment, int(aid))
                        seen_att_ids.add(int(aid))
                        if extra_att is not None:
                            event_attachments.append(extra_att)
            except Exception:
                pass
        paths = [attachment.file_path for attachment in event_attachments if getattr(attachment, "file_path", None)]
        try:
            rb = _load_recycle_bin()
            if rb is not None and callable(getattr(rb, "close_out_hard_deleted_entities", None)):
                uid = None
                if callable(getattr(rb, "_current_actor", None)):
                    try:
                        uid, _ = rb._current_actor(ctx)
                    except Exception:
                        uid = None
                rb.close_out_hard_deleted_entities(
                    db,
                    entity_type="complaint_event",
                    entity_id=event.id,
                    project_id=pid,
                    child_attachment_ids=seen_att_ids,
                    actor_uid=uid,
                )
            for attachment in event_attachments:
                db.session.delete(attachment)
            db.session.delete(event)
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        for relative_path in paths:
            try:
                path = UPLOAD_FOLDER / relative_path
                _validate_file_path(path, relative_path)
                if path.exists():
                    path.unlink()
            except Exception as error:
                app.logger.warning("删除质疑过程附件失败: %s", error)
        return jsonify({"ok": True})
    data = request.get_json() or {}
    for field in ("event_type", "sender", "recipient", "handler", "summary", "status"):
        if field in data:
            setattr(event, field, str(data.get(field) or "").strip())
    if "event_time" in data:
        try:
            event.event_time = datetime.fromisoformat(data["event_time"])
        except (TypeError, ValueError):
            return jsonify({"error": "发生时间格式不正确"}), 400
    if "deadline" in data:
        event.deadline = _parse_optional_date(data.get("deadline"))
    db.session.commit()
    return jsonify(event.to_dict())


def api_update_delete_clarification(ctx: Any, pid: int, item_id: int):
    ctx = _ctx(ctx)
    AnnouncementClarification = ctx.get("AnnouncementClarification")
    _apply_clarification_data = ctx.get("_apply_clarification_data")
    _delete_attachment_file = ctx.get("_delete_attachment_file")
    _recalculate_clarification_deadline = ctx.get(
        "_recalculate_clarification_deadline",
        lambda proj, fb=None: recalculate_clarification_deadline(ctx, proj, fb),
    )
    app = ctx.get("app")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    request = ctx.get("request")
    item = AnnouncementClarification.query.filter_by(id=item_id, project_id=pid).first_or_404()
    fallback = item.original_deadline if item.affects_deadline else None
    if request.method == "DELETE":
        rb = _load_recycle_bin()
        if rb is not None and rb.is_enabled(ctx):
            if _wants_permanent_delete(ctx):
                if not rb.can_permanent_delete(ctx, "clarification"):
                    return jsonify({"error": "仅管理员可彻底删除澄清/更正记录"}), 403
            else:
                reason = rb._extract_delete_reason(request)
                return jsonify(
                    rb.soft_delete_clarification(
                        ctx,
                        item,
                        fallback=fallback,
                        recalculate_fn=_recalculate_clarification_deadline,
                        reason=reason,
                    )
                )
        hard_delete_clarification_record(ctx, item, fallback=fallback, recalculate_fn=_recalculate_clarification_deadline)
        return jsonify({"ok": True})
    data = request.get_json() or {}
    _apply_clarification_data(item, data, pid)
    _recalculate_clarification_deadline(item.project, fallback)
    db.session.commit()
    return jsonify(item.to_dict())


def _include_challenge_states(ctx: Any, payloads: list) -> None:
    db = ctx.get("db")
    if not payloads or ctx.get("Complaint") is None or not callable(getattr(db.session, "execute", None)):
        return
    if __package__:
        from . import project_listing
    else:
        import project_listing
    states = project_listing.project_challenge_states(db, (item["id"] for item in payloads))
    for item in payloads:
        item["challenge_state"] = states.get(item["id"], "")


def api_projects(ctx: Any = None):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    datetime = ctx.get("datetime", _default_datetime)
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    load_app_settings = ctx.get("load_app_settings")
    selectinload = ctx.get("selectinload", _default_selectinload)
    text = ctx.get("text", _default_text)
    try:
        import lot_supplier_risk
    except ModuleNotFoundError:
        from src.backend_patches import lot_supplier_risk
    try:
        import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates
    try:
        try:
            from . import project_listing
        except ImportError:
            import project_listing
    except ModuleNotFoundError:
        project_listing = None

    req = ctx.get("request")
    args = getattr(req, "args", None) if req is not None else None
    compact = bool(args and str(args.get("compact") or "").strip().lower() in ("1", "true", "yes"))
    settings = load_app_settings()
    current = datetime.now()

    project_options = [
        selectinload(Project.stages),
        selectinload(Project.lots),
        selectinload(Project.registrations),
    ]
    checklist_relation = getattr(Project, "stage_checklist_items", None)
    if checklist_relation is not None and not compact:
        project_options.insert(1, selectinload(checklist_relation))

    query = Project.query.options(*project_options)
    # SQL-level pre-filtering for explicit year, cold-archive window, search, and SQL pagination
    rb = _load_recycle_bin()
    rb_enabled = bool(rb is not None and rb.is_enabled(ctx))
    deleted_pids = rb.deleted_ids(db, "project") if rb_enabled else set()

    year_param = str(args.get("year") or "").strip().lower() if args else ""
    method_param = str(args.get("method") or "").strip() if args else ""
    q_param = str(args.get("q") or "").strip() if args else ""
    status_param = str(args.get("status") or "").strip().lower() if args else ""
    paginated_req = bool(args and str(args.get("paginated") or "").strip().lower() in ("1", "true", "yes"))

    _win = 0
    _cutoff_year = None
    if project_listing is not None:
        _win, _cutoff_year = project_listing.resolve_cold_archive_window(settings, today=current.date())

    def _apply_sql_filters(q_obj, *, include_status: bool = False):
        if deleted_pids and hasattr(Project, "id"):
            q_obj = q_obj.filter(~Project.id.in_(deleted_pids))
        if method_param and hasattr(Project, "method"):
            q_obj = q_obj.filter(Project.method == method_param)
        if q_param and hasattr(Project, "number") and hasattr(Project, "name"):
            from sqlalchemy import or_
            like_pat = f"%{q_param}%"
            or_clauses = [
                Project.number.ilike(like_pat),
                Project.name.ilike(like_pat),
            ]
            for attr in ("purchaser", "method", "prepare_owner", "review_owner", "year"):
                col = getattr(Project, attr, None)
                if col is not None:
                    or_clauses.append(col.ilike(like_pat))
            q_obj = q_obj.filter(or_(*or_clauses))
        if year_param and year_param not in ("all", "active", "archived") and hasattr(Project, "year"):
            q_obj = q_obj.filter(Project.year == year_param)
        if include_status:
            if status_param == "terminated" and hasattr(Project, "is_terminated"):
                q_obj = q_obj.filter(Project.is_terminated.is_(True))
            elif status_param in ("liubiao", "feibiao") and hasattr(Project, "is_terminated") and hasattr(Project, "terminated_type"):
                q_obj = q_obj.filter(Project.is_terminated.is_(True), Project.terminated_type == status_param)
        return q_obj

    scope_ids: list[int] | None = None
    if year_param in ("active", "archived") and project_listing is not None and callable(getattr(db.session, "execute", None)):
        if _cutoff_year is not None:
            try:
                try:
                    import schema_models
                except ModuleNotFoundError:
                    from src.backend_patches import schema_models
                stage_cols = schema_models.table_columns(db.session, "stages", text)
                rem_cond = "COALESCE(s.template_removed, 0) = 0" if "template_removed" in stage_cols else "1=1"
                if year_param == "active":
                    having_sql = (
                        "HAVING (CAST(p.year AS INTEGER) >= :cutoff OR p.year IS NULL OR p.year = '') "
                        "OR (COALESCE(p.is_terminated, 0) = 0 AND "
                        f"SUM(CASE WHEN {rem_cond} AND COALESCE(s.completed, 0) = 0 AND COALESCE(s.skipped, 0) = 0 THEN 1 ELSE 0 END) > 0)"
                    )
                else:
                    having_sql = (
                        "HAVING (p.year IS NOT NULL AND p.year != '' AND CAST(p.year AS INTEGER) < :cutoff) "
                        "AND (COALESCE(p.is_terminated, 0) = 1 OR ("
                        f"SUM(CASE WHEN {rem_cond} THEN 1 ELSE 0 END) > 0 AND "
                        f"SUM(CASE WHEN {rem_cond} AND COALESCE(s.completed, 0) = 0 AND COALESCE(s.skipped, 0) = 0 THEN 1 ELSE 0 END) = 0))"
                    )
                scope_ids = [
                    int(r[0])
                    for r in db.session.execute(
                        text(
                            "SELECT p.id FROM projects p "
                            "LEFT JOIN stages s ON s.project_id = p.id "
                            f"GROUP BY p.id, p.year, p.is_terminated {having_sql}"
                        ),
                        {"cutoff": _cutoff_year},
                    ).fetchall()
                    if int(r[0]) not in deleted_pids
                ]
            except Exception:
                scope_ids = None
        elif year_param == "archived":
            scope_ids = []

    if scope_ids is not None and not scope_ids:
        if paginated_req:
            try:
                _ps = min(500, max(1, int(args.get("page_size") or 100)))
            except (TypeError, ValueError):
                _ps = 100
            return jsonify({
                "items": [],
                "total": 0,
                "page": 1,
                "page_size": _ps,
                "has_more": False,
                "year_scope": year_param,
                "active_years_window": _win,
                "cutoff_year": _cutoff_year,
            })
        return jsonify([])

    list_meta = None
    sql_paginated_done = False
    sort_param = str(args.get("sort") or "").strip().lower() if args else ""
    normalized_sort = project_listing.normalize_sort_key(sort_param) if project_listing is not None else ""
    sql_status_ok = status_param in ("", "all", "terminated", "liubiao", "feibiao")
    if (
        paginated_req
        and project_listing is not None
        and callable(getattr(db.session, "query", None))
        and hasattr(Project, "id")
        and hasattr(Project, "year")
        and hasattr(Project, "number")
        and hasattr(Project, "__table__")
    ):
        try:
            try:
                page = max(1, int(args.get("page") or 1))
            except (TypeError, ValueError):
                page = 1
            try:
                page_size = min(500, max(1, int(args.get("page_size") or 100)))
            except (TypeError, ValueError):
                page_size = 100
            if not normalized_sort and sql_status_ok and scope_ids is None:
                id_q = _apply_sql_filters(db.session.query(Project.id), include_status=True)
                total = int(id_q.count() or 0)
                page_ids = [
                    int(r[0])
                    for r in id_q.order_by(Project.year.desc(), Project.number, Project.id)
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                    .all()
                ]
            else:
                term_col = getattr(Project, "is_terminated", None)
                term_type_col = getattr(Project, "terminated_type", None)
                cols = [Project.id, Project.number, Project.year]
                if term_col is not None:
                    cols.append(term_col)
                if term_type_col is not None:
                    cols.append(term_type_col)
                scalar_q = _apply_sql_filters(db.session.query(*cols), include_status=sql_status_ok)
                raw_rows = scalar_q.all()
                tuples = [
                    (
                        int(r[0]),
                        r[1],
                        r[2],
                        bool(r[3]) if term_col is not None else False,
                        (r[4] if term_type_col is not None else "") if term_col is not None else (r[3] if term_type_col is not None else ""),
                    )
                    for r in raw_rows
                ]
                page_ids, total = project_listing.paginate_project_ids_sorted(
                    db.session,
                    text,
                    tuples,
                    sort_key=normalized_sort,
                    status_param=status_param,
                    scope_id_set=set(scope_ids) if scope_ids is not None else None,
                    page=page,
                    page_size=page_size,
                    today=current.date(),
                )
            if page_ids:
                hydrated = (
                    Project.query.options(*project_options)
                    .filter(Project.id.in_(page_ids))
                    .all()
                )
                by_id = {int(p.id): p for p in hydrated}
                projects = [by_id[pid] for pid in page_ids if pid in by_id]
            else:
                projects = []
            list_meta = {
                "paginated": True,
                "total": total,
                "page": page,
                "page_size": page_size,
                "has_more": (page * page_size) < total,
                "year_scope": year_param or "all",
                "sort": normalized_sort or "default",
                "active_years_window": _win,
                "cutoff_year": _cutoff_year,
            }
            sql_paginated_done = True
        except Exception:
            sql_paginated_done = False

    if not sql_paginated_done:
        query = _apply_sql_filters(query, include_status=sql_status_ok)
        if scope_ids is not None:
            query = query.filter(Project.id.in_(scope_ids))
        projects = query.order_by(Project.year.desc(), Project.number).all()
        if rb_enabled and not deleted_pids:
            projects = rb.filter_active_projects(db, projects, ctx=ctx)
        if project_listing is not None and args:
            projects, list_meta = project_listing.filter_and_paginate_projects(
                projects, args, settings, today=current.date()
            )

    use_v5_catalog = bool(ctx.get("_PROCUREMENT_CATALOG_ENABLED") or settings.get("stage_templates"))
    stage_prefetched = None
    risk_prefetched = None
    import inspect

    def _supports_kw(fn: Any, name: str) -> bool:
        try:
            sig = inspect.signature(fn)
            if name in sig.parameters:
                return True
            return any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        except (TypeError, ValueError):
            return False

    can_batch_stage = callable(getattr(stage_templates, "batch_load_project_stage_data", None))
    can_batch_risk = callable(getattr(lot_supplier_risk, "batch_load_project_risk_data", None))
    serialize_accepts_pf = _supports_kw(getattr(stage_templates, "serialize_v5_project_payload", None), "prefetched")
    enrich_loc_accepts_pf = _supports_kw(getattr(stage_templates, "enrich_stage_locations", None), "prefetched")
    risk_accepts_pf = _supports_kw(getattr(lot_supplier_risk, "enrich_project_payload", None), "prefetched")

    if projects and callable(getattr(db.session, "execute", None)):
        pids = [p.id for p in projects if getattr(p, "id", None) is not None]
        if can_batch_stage and (serialize_accepts_pf or enrich_loc_accepts_pf):
            stage_prefetched = stage_templates.batch_load_project_stage_data(db.session, text, pids)
        if can_batch_risk and risk_accepts_pf:
            risk_prefetched = lot_supplier_risk.batch_load_project_risk_data(db, projects)

    def serialize_summary(project):
        summary = dict(project.to_summary_dict())
        for field in ("created_at", "completed_at"):
            value = getattr(project, field, None)
            if value is not None:
                summary[field] = value.isoformat() if hasattr(value, "isoformat") else str(value)
        use_v5 = use_v5_catalog or getattr(project, "method", "") == "网上竞价"
        if use_v5:
            if stage_prefetched is not None and serialize_accepts_pf:
                base_payload = stage_templates.serialize_v5_project_payload(
                    db.session,
                    text,
                    project,
                    summary,
                    settings,
                    ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
                    ctx.get("STAGES", []),
                    prefetched=stage_prefetched,
                    compact=compact,
                )
            else:
                base_payload = stage_templates.serialize_v5_project_payload(
                    db.session,
                    text,
                    project,
                    summary,
                    settings,
                    ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
                    ctx.get("STAGES", []),
                )
        else:
            base_payload = stage_workflow.apply_project_payload(
                summary, settings, ctx.get("STAGES", [])
            )
        if risk_prefetched is not None and risk_accepts_pf:
            enriched = lot_supplier_risk.enrich_project_payload(
                db, base_payload, project, current, settings, prefetched=risk_prefetched
            )
        else:
            enriched = lot_supplier_risk.enrich_project_payload(
                db, base_payload, project, current, settings
            )
        if stage_prefetched is not None and enrich_loc_accepts_pf:
            return stage_templates.enrich_stage_locations(
                db.session, text, project.id, enriched, prefetched=stage_prefetched
            )
        return stage_templates.enrich_stage_locations(db.session, text, project.id, enriched)

    serialized_items = [serialize_summary(project) for project in projects]
    _include_challenge_states(ctx, serialized_items)
    if list_meta and list_meta.get("paginated"):
        return jsonify({
            "items": serialized_items,
            "total": list_meta["total"],
            "page": list_meta["page"],
            "page_size": list_meta["page_size"],
            "has_more": list_meta["has_more"],
            "year_scope": list_meta["year_scope"],
            "active_years_window": list_meta["active_years_window"],
            "cutoff_year": list_meta["cutoff_year"],
        })
    return jsonify(serialized_items)


def api_project(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    datetime = ctx.get("datetime", _default_datetime)
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    load_app_settings = ctx.get("load_app_settings")
    selectinload = ctx.get("selectinload", _default_selectinload)
    text = ctx.get("text", _default_text)
    try:
        import lot_supplier_risk
    except ModuleNotFoundError:
        from src.backend_patches import lot_supplier_risk
    try:
        import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates

    project_options = [
        selectinload(Project.stages),
        selectinload(Project.lots),
        selectinload(Project.registrations),
    ]
    checklist_relation = getattr(Project, "stage_checklist_items", None)
    if checklist_relation is not None:
        project_options.insert(1, selectinload(checklist_relation))
    project = Project.query.options(*project_options).filter_by(id=pid).first_or_404()
    catalog_snapshot=None
    if ctx.get('_PROCUREMENT_CATALOG_ENABLED'):
        try:
            from . import procurement_catalog
        except ImportError:
            import procurement_catalog
        catalog_snapshot=procurement_catalog.project_snapshot(db,project.id)
    can_initialize = True
    permissions_app = ctx.get('app')
    if permissions_app is not None and 'account_permissions' in getattr(permissions_app, 'extensions', {}):
        try:
            try:
                from . import account_permissions
            except ImportError:
                import account_permissions
        except ModuleNotFoundError:
            from src.backend_patches import account_permissions
        can_initialize = account_permissions.request_can(permissions_app, 'edit_projects')
    if can_initialize and (not catalog_snapshot or not catalog_snapshot.get('workflow_revision')):
        project.ensure_workflow_defaults()
        db.session.commit()
    settings = load_app_settings()
    payload = lot_supplier_risk.enrich_project_payload(
        db,
        stage_templates.serialize_v5_project_payload(
            db.session,
            text,
            project,
            project.to_dict(),
            settings,
            ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
            ctx.get("STAGES", []),
        ) if ctx.get("_PROCUREMENT_CATALOG_ENABLED") or settings.get("stage_templates") or getattr(project, "method", "") == "网上竞价" else stage_workflow.apply_project_payload(
            project.to_dict(), settings, ctx.get("STAGES", [])
        ),
        project,
        datetime.now(),
        settings,
    )
    rb = _load_recycle_bin()
    if rb is not None and rb.is_enabled(ctx):
        child_deleted = rb.deleted_child_ids(db, pid)
        del_atts = child_deleted["attachment"]
        del_comps = child_deleted["complaint"]
        del_clars = child_deleted["clarification"]
        if del_comps or del_clars:
            del_atts = rb.hidden_attachment_ids(db, project_id=pid)
        if del_atts:
            if isinstance(payload.get("attachments"), list):
                payload["attachments"] = [a for a in payload["attachments"] if a.get("id") not in del_atts]
            for coll_key in ("registrations", "complaints", "clarifications"):
                if isinstance(payload.get(coll_key), list):
                    for rec in payload[coll_key]:
                        if isinstance(rec, dict) and isinstance(rec.get("attachments"), list):
                            rec["attachments"] = [a for a in rec["attachments"] if a.get("id") not in del_atts]
                        if coll_key == "complaints" and isinstance(rec, dict) and isinstance(rec.get("events"), list):
                            for ev in rec["events"]:
                                if isinstance(ev, dict) and isinstance(ev.get("attachments"), list):
                                    ev["attachments"] = [a for a in ev["attachments"] if a.get("id") not in del_atts]
        if del_comps and isinstance(payload.get("complaints"), list):
            payload["complaints"] = [c for c in payload["complaints"] if c.get("id") not in del_comps]
        if del_clars and isinstance(payload.get("clarifications"), list):
            payload["clarifications"] = [c for c in payload["clarifications"] if c.get("id") not in del_clars]
    _include_challenge_states(ctx, [payload])
    return jsonify(stage_templates.enrich_stage_locations(db.session, text, pid, payload))


def api_update_stage(ctx: Any, pid: int, stage_key: str):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    STAGES = ctx.get("STAGES", [])
    datetime = ctx.get("datetime", _default_datetime)
    db = ctx.get("db")
    joinedload = ctx.get("joinedload", _default_joinedload)
    jsonify = ctx.get("jsonify")
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    request = ctx.get("request")
    text = ctx.get("text", _default_text)
    try:
        try:
            from . import schema_models
        except ImportError:
            import schema_models
    except ModuleNotFoundError:
        from src.backend_patches import schema_models
    try:
        try:
            from . import stage_templates
        except ImportError:
            import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates
    p = Project.query.options(joinedload(Project.stages)).filter_by(id=pid).first_or_404()
    if p.is_terminated:
        return jsonify({"error": "项目已关闭，无法修改阶段"}), 400
    s = p.get_stage(stage_key)
    if s is None:
        return jsonify({"error": "阶段不存在"}), 404
    # Legacy frozen Stage models do not map this SQL-only snapshot column.
    # Old windows/clients must not undo or rewrite archived historical facts.
    columns = schema_models.table_columns(db.session, 'stages', text)
    snapshot = db.session.execute(
        text('SELECT template_removed FROM stages WHERE project_id=:pid AND stage_key=:key'),
        {'pid': pid, 'key': stage_key}).fetchone() if 'template_removed' in columns else None
    if getattr(s, 'template_removed', False) or (snapshot is not None and snapshot[0]):
        return jsonify(error='该阶段已归入历史记录，不能修改', code='STAGE_ARCHIVED'), 409
    data = request.get_json() or {}
    if not isinstance(data, dict):
        return jsonify({"error": "阶段数据格式错误"}), 400
    try:
        planned_datetime = stage_templates.parse_stage_datetime(data.get("planned_at"), "计划时间", allow_date=True)
        completed_date, completed_at = stage_templates.stage_completion_input(data)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    venues = {}
    for field in ("opening_location", "evaluation_location"):
        if field in data:
            value = data[field]
            if not isinstance(value, str) or len(value) > 500:
                return jsonify({"error": "地点须为不超过500字的文本"}), 400
            venues[field] = value.strip()
    if "publication_url" in data:
        from urllib.parse import urlsplit
        value = data["publication_url"]
        if not isinstance(value, str) or len(value) > 2000:
            return jsonify({"error": "公示链接须为不超过2000字的文本"}), 400
        value = value.strip()
        try:
            parsed = urlsplit(value)
            valid = not value or (parsed.scheme in ("http", "https") and parsed.hostname and not any(c.isspace() for c in value))
        except ValueError:
            valid = False
        if not valid:
            return jsonify({"error": "请输入完整的 http 或 https 公示链接"}), 400
        venues["publication_url"] = value
    if data.get("completed") and not s.completed and not data.get("force_complete") and not data.get("skipped"):
        pending = [item.title for item in p.stage_checklist_items
                   if item.stage_key == stage_key and item.required and not item.completed]
        if pending:
            return jsonify({"error": "请先完成阶段必检项", "pending_checklist": pending}), 409
    was_completed, was_skipped = bool(s.completed), bool(s.skipped)
    write_completion_time = False
    try:
        if "completed" in data:
            s.completed = bool(data["completed"])
        if "skipped" in data:
            s.skipped = bool(data["skipped"])
            if s.skipped and not was_skipped:
                s.completed = True
        if not s.completed:
            s.completed_date = None
            completed_at = None
            write_completion_time = True
        elif completed_at is not None:
            s.completed_date = completed_date
            write_completion_time = True
        elif completed_date is not None:
            s.completed_date = completed_date
            # An old client cannot supply the old hour for a changed date.
            write_completion_time = True
        elif not was_completed or (s.skipped and not was_skipped):
            completed_at = datetime.now().replace(second=0, microsecond=0)
            s.completed_date = completed_at.date()
            write_completion_time = True
        elif "completed_at" in data:
            write_completion_time = True
        if "planned_at" in data:
            s.planned_datetime = planned_datetime
        if "notes" in data:
            s.notes = data["notes"]
        if "responsible_person" in data:
            s.responsible_person = data["responsible_person"] or ""
        if write_completion_time:
            stage_templates.persist_stage_completed_at(db.session, text, pid, stage_key, completed_at)
        if venues:
            stage_templates.ensure_v5_snapshot_schema(db.session, text)
            for field, value in venues.items():
                db.session.execute(text(f"UPDATE stages SET {field}=:value WHERE project_id=:pid AND stage_key=:key"),
                                   {"value": value, "pid": pid, "key": stage_key})
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "阶段保存失败，修改已回滚"}), 500
    if data.get("completed") and s.completed:
        stage_name = next((row["name"] for row in STAGES if row["key"] == stage_key), stage_key)
        import json
        log_operation("complete_stage", "stage", s.id,
                      f"完成阶段：{p.number} - {stage_name}",
                      json.dumps({"project_id": p.id, "stage_key": stage_key, "date": str(s.completed_date)}, ensure_ascii=False))
    payload = p.to_dict()
    settings_loader = ctx.get("load_app_settings")
    settings = settings_loader() if callable(settings_loader) else {}
    if ctx.get("_PROCUREMENT_CATALOG_ENABLED") or settings.get("stage_templates") or getattr(p, "method", "") == "网上竞价":
        payload = stage_templates.serialize_v5_project_payload(
            db.session, text, p, payload, settings,
            ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
            ctx.get("STAGES", []),
        )
    return jsonify(stage_templates.enrich_stage_locations(db.session, text, pid, payload))


def api_batch_advance_stage(ctx: Any = None):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    STAGES = ctx.get("STAGES", [])
    db = ctx.get("db")
    joinedload = ctx.get("joinedload", _default_joinedload)
    jsonify = ctx.get("jsonify")
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    request = ctx.get("request")
    text = ctx.get("text", _default_text)
    import json
    from datetime import datetime
    try:
        try:
            from . import stage_templates
        except ImportError:
            import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates

    data = request.get_json() or {}
    if not isinstance(data, dict):
        return jsonify({"error": "批量推进数据格式错误"}), 400
    stage_key = data.get("stage_key")
    if not isinstance(stage_key, str) or not stage_key:
        return jsonify({"error": "缺少阶段参数"}), 400
    project_ids = data.get("project_ids")
    if not isinstance(project_ids, list) or not project_ids:
        return jsonify({"error": "请选择至少一个项目"}), 400
    ids = []
    for value in project_ids:
        valid = isinstance(value, int) and not isinstance(value, bool)
        if isinstance(value, str):
            valid = bool(value) and len(value) <= 64 and value.isascii() and value.isdecimal()
        if not valid or not 1 <= int(value) <= 9223372036854775807:
            return jsonify({"error": "项目编号格式不正确"}), 400
        identity = int(value)
        if identity not in ids:
            ids.append(identity)
    try:
        completed_date, completed_at = stage_templates.stage_completion_input(data)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if completed_date is None:
        completed_at = datetime.now().replace(second=0, microsecond=0)
        completed_date = completed_at.date()

    success, skipped, errors, eligible, labels = [], [], [], [], []
    try:
        try:
            try:
                from . import schema_models
            except ImportError:
                import schema_models
        except ModuleNotFoundError:
            from src.backend_patches import schema_models
        columns = schema_models.table_columns(db.session, "stages", text)
        removed_column = "template_removed" if "template_removed" in columns else "0"
        name_column = "stage_name" if "stage_name" in columns else "NULL"
        rb = _load_recycle_bin()
        deleted_pids = rb.deleted_ids(db, "project") if rb is not None else set()
        for pid in ids:
            if pid in deleted_pids:
                errors.append(f"项目ID {pid} 已移入回收站")
                continue
            project = Project.query.options(joinedload(Project.stages)).filter_by(id=pid).first()
            if project is None:
                errors.append(f"项目ID {pid} 不存在")
                continue
            if project.is_terminated:
                skipped.append(f"{project.number} (已终止)")
                continue
            stage = project.get_stage(stage_key)
            if stage is None:
                errors.append(f"{project.number} 缺少该阶段")
                continue
            snapshot = db.session.execute(
                text("SELECT " + removed_column + "," + name_column +
                     " FROM stages WHERE project_id=:pid AND stage_key=:key"),
                {"pid": pid, "key": stage_key},
            ).fetchone()
            if getattr(stage, "template_removed", False) or (snapshot is not None and snapshot[0]):
                errors.append(f"{project.number} 该阶段已从模板移除")
                continue
            if stage.completed or stage.skipped:
                skipped.append(f"{project.number} (已完成/已跳过)")
                continue
            pending = [item.title for item in project.stage_checklist_items
                       if item.stage_key == stage_key and item.required and not item.completed]
            if pending:
                skipped.append(f"{project.number} (尚有{len(pending)}项必检清单未完成)")
                continue
            stage_name = snapshot[1] if snapshot is not None and snapshot[1] else getattr(stage, "stage_name", None)
            if not stage_name:
                stage_name = next((row["name"] for row in STAGES if row["key"] == stage_key), stage_key)
            if stage_name not in labels:
                labels.append(stage_name)
            eligible.append((project, stage))
        for project, stage in eligible:
            stage.completed = True
            stage.completed_date = completed_date
            stage_templates.persist_stage_completed_at(db.session, text, project.id, stage_key, completed_at)
            success.append(project.number)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"success": False, "advanced_count": 0, "skipped": skipped,
                        "errors": errors + ["批量推进保存失败，未推进任何项目"],
                        "message": "批量推进失败，修改已回滚"}), 500
    stage_name = " / ".join(labels) or stage_key
    try:
        log_operation("batch_advance_stage", "system", 0,
                      f"批量推进阶段「{stage_name}」: {len(success)}个项目",
                      json.dumps({"stage": stage_key, "projects": success,
                                  "date": str(completed_date)}, ensure_ascii=False))
    except Exception:
        db.session.rollback()
    return jsonify({"success": True, "advanced_count": len(success), "skipped": skipped,
                    "errors": errors, "message": f"成功推进 {len(success)} 个项目的「{stage_name}」阶段"})


def _recalculate_clarification_deadline(ctx: Any, project: Any, fallback: Any = None):
    ctx = _ctx(ctx)
    AnnouncementClarification = ctx.get("AnnouncementClarification")
    db = ctx.get("db")
    text = ctx.get("text", _default_text)
    import json
    from datetime import datetime

    opening = None
    try:
        try:
            from . import schema_models
        except ImportError:
            import schema_models
    except ModuleNotFoundError:
        from src.backend_patches import schema_models
    columns = schema_models.table_columns(db.session, "stages", text)
    if "modules_json" in columns:
        removed = "template_removed" if "template_removed" in columns else "0"
        order = "COALESCE(stage_position,id),id" if "stage_position" in columns else "id"
        rows = db.session.execute(
            text("SELECT stage_key,modules_json," + removed +
                 " FROM stages WHERE project_id=:pid ORDER BY " + order),
            {"pid": project.id},
        ).fetchall()
        for stage_key, raw_modules, is_removed in rows:
            if is_removed:
                continue
            if raw_modules is None:
                modules = ["bid_opening"] if stage_key == "bid_opening" else []
            else:
                try:
                    modules = json.loads(raw_modules)
                except (TypeError, ValueError):
                    modules = []
            if isinstance(modules, list) and "bid_opening" in modules:
                opening = project.get_stage(stage_key)
                if opening is not None:
                    break
    else:
        opening = project.get_stage("bid_opening")
    if opening is None:
        return
    active = AnnouncementClarification.query.filter_by(
        project_id=project.id, affects_deadline=True,
    ).filter(AnnouncementClarification.new_deadline.isnot(None)).all()
    rb = _load_recycle_bin()
    if rb is not None and active:
        del_clars = rb.deleted_ids(db, "clarification", project_id=project.id)
        if del_clars:
            active = [item for item in active if getattr(item, "id", None) not in del_clars]
    if active:
        latest = max(active, key=lambda item: (item.created_at or datetime.min, item.id or 0))
        opening.planned_datetime = latest.new_deadline
    elif fallback is not None:
        opening.planned_datetime = fallback


recalculate_clarification_deadline = _recalculate_clarification_deadline


def api_create_stage_checklist_item(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    StageChecklistItem = ctx.get("StageChecklistItem")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    request = ctx.get("request")
    text = ctx.get("text", _default_text)
    try:
        try:
            from . import stage_templates
        except ImportError:
            import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates

    project = db.get_or_404(Project, pid)
    data = request.get_json() or {}
    if not isinstance(data, dict):
        return jsonify({"error": "检查项数据格式错误"}), 400
    stage_key = data.get("stage_key")
    title = str(data.get("title") or "").strip()
    stage = project.get_stage(stage_key) if isinstance(stage_key, str) else None
    if stage is None or not title:
        return jsonify({"error": "阶段或检查项名称无效"}), 400
    stage_templates.ensure_v5_snapshot_schema(db.session, text)
    snapshot = db.session.execute(
        text("SELECT template_removed FROM stages WHERE project_id=:pid AND stage_key=:key"),
        {"pid": pid, "key": stage_key},
    ).fetchone()
    if getattr(stage, "template_removed", False) or (snapshot is not None and snapshot[0]):
        return jsonify({"error": "阶段或检查项名称无效"}), 400
    order = max([item.sort_order for item in project.stage_checklist_items
                 if item.stage_key == stage_key] or [0]) + 1
    item = StageChecklistItem(
        project_id=pid, stage_key=stage_key, title=title[:250],
        required=bool(data.get("required", True)), sort_order=order, is_custom=True,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


def api_create_project(ctx: Any = None):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    date = ctx.get("date", _default_date)
    db = ctx.get("db")
    jsonify = ctx.get("jsonify", lambda v: v)
    load_app_settings = ctx.get("load_app_settings", lambda: {})
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    request = ctx.get("request")
    session = ctx.get("session", {})
    text = ctx.get("text", _default_text)
    if ctx.get('_PROCUREMENT_CATALOG_ENABLED'):
        try:
            from . import procurement_api
        except ImportError:
            import procurement_api
        return procurement_api.create_project(ctx)
    try:
        try:
            from . import stage_templates
        except ImportError:
            import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates
    try:
        try:
            from . import stage_workflow
        except ImportError:
            import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow

    data = request.get_json() or {}
    number = str(data.get("number") or "").strip()
    name = str(data.get("name") or "").strip()
    if not number or not name:
        return jsonify({"error": "项目编号和名称不能为空"}), 400
    if Project.query.filter_by(number=number).first():
        return jsonify({"error": f"项目编号 {number} 已存在"}), 400
    try:
        year = int(data.get("year", date.today().year))
    except (TypeError, ValueError):
        return jsonify({"error": "年度格式不正确"}), 400

    method = str(data.get("method") or "").strip()
    methods = ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS)
    if method not in methods:
        return jsonify({"error": "采购方式不正确"}), 400
    project = Project(
        number=number,
        name=name,
        purchaser=str(data.get("purchaser") or ""),
        method=method,
        budget=str(data.get("budget") or ""),
        year=year,
        no_deposit=bool(data.get("no_deposit", False)),
        prepare_owner=str(data.get("prepare_owner") or ""),
        review_owner=str(data.get("review_owner") or ""),
    )
    db.session.add(project)
    db.session.flush()
    project.ensure_stages()
    db.session.flush()

    settings = load_app_settings()
    definitions = ctx.get("STAGES", [])
    template = stage_templates.initialize_project_workflow(
        db.session, text, project, settings, methods, definitions,
        enroll_online_bidding=True,
    )

    if 'deposit_required_amount' in data and not project.no_deposit:
        try:import tender_guarantee
        except ModuleNotFoundError:from src.backend_patches import tender_guarantee
        tender_guarantee.set_document_amount(db,project,data['deposit_required_amount'],actor=session.get('user_id',''))
    db.session.commit()
    try:
        db.session.expire(project, ["stages", "stage_checklist_items"])
    except (AttributeError, TypeError):
        pass
    log_operation(
        "create_project", "project", project.id,
        f"创建项目：{project.number} {project.name}",
    )
    payload = stage_templates.serialize_v5_project_payload(
        db.session,
        text,
        project,
        project.to_dict(),
        settings,
        methods,
        definitions,
    )
    workflow_definitions = [
        {"key": row["id"], "name": row["name"], "icon": row["icon"]}
        for row in template
    ]
    payload = stage_workflow.apply_project_payload(
        payload, {}, workflow_definitions
    )
    return jsonify(payload), 201


def api_update_project(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    try:
        from . import procurement_api
    except ImportError:
        import procurement_api
    return procurement_api.update_project(ctx, pid)


def api_get_lots(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    project = db.get_or_404(Project, pid)
    return jsonify([lot.to_dict() for lot in project.lots])


def api_create_lot(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    ProjectLot = ctx.get("ProjectLot")
    _ensure_project_resource = ctx.get("_ensure_project_resource")
    app = ctx.get("app")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    request = ctx.get("request")
    session = ctx.get("session", {})
    try:
        from . import lot_supplier_risk
    except ImportError:
        import lot_supplier_risk
    project = db.get_or_404(Project, pid)
    data = request.get_json() or {}
    source_id = data.get("reprocurement_source_lot_id")
    try:
        if source_id:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以创建重新采购轮次"}), 403
            source = _ensure_project_resource(db.get_or_404(ProjectLot, int(source_id)), pid)
            result = lot_supplier_risk.create_reprocurement(
                db, project, source, data, session.get("user_id")
            )
            project.is_terminated = False
            project.terminated_type = None
            project.terminated_reason = ""
            db.session.commit()
            return jsonify(result), 201
        if project.is_terminated:
            return jsonify({"error": "项目已关闭"}), 400
        lot = ProjectLot(
            project_id=pid,
            lot_number=str(data.get("lot_number") or "").strip(),
            lot_name=str(data.get("lot_name") or "").strip(),
            budget=data.get("budget"),
            notes=str(data.get("notes") or "").strip(),
        )
        if not lot.lot_number or not lot.lot_name:
            return jsonify({"error": "包号和包名不能为空"}), 400
        db.session.add(lot)
        if 'deposit_required_amount' in data:
            try:import tender_guarantee
            except ModuleNotFoundError:from src.backend_patches import tender_guarantee
            db.session.flush()
            # Include the freshly created lot before validating its amount.
            if lot not in project.lots:project.lots.append(lot)
            tender_guarantee.set_document_amount(db,project,data['deposit_required_amount'],lot.id,actor=session.get('user_id',''))
        db.session.commit()
        return jsonify(lot.to_dict()), 201
    except lot_supplier_risk.ValidationError as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400
    except Exception:
        db.session.rollback()
        app.logger.exception("lot create failed")
        return jsonify({"error": "采购包保存失败"}), 500


def api_update_lot(ctx: Any, pid: int, lid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    ProjectLot = ctx.get("ProjectLot")
    _ensure_project_resource = ctx.get("_ensure_project_resource")
    app = ctx.get("app")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    request = ctx.get("request")
    session = ctx.get("session", {})
    try:
        from . import lot_supplier_risk
    except ImportError:
        import lot_supplier_risk
    project = db.get_or_404(Project, pid)
    lot = _ensure_project_resource(db.get_or_404(ProjectLot, lid), pid)
    data = request.get_json() or {}
    action = data.get("lot_action")
    try:
        if action == "manual_liubiao":
            result = lot_supplier_risk.manual_liubiao(
                db, project, lot, data.get("response_count"), data.get("reason"),
                session.get("user_id"),
            )
            db.session.commit()
            return jsonify(result)
        if action == "restore":
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以撤销流标"}), 403
            result = lot_supplier_risk.restore_lot(
                db, project, lot, data.get("reason"), session.get("user_id")
            )
            project.is_terminated = False
            project.terminated_type = None
            project.terminated_reason = ""
            db.session.commit()
            return jsonify(result)
        if action == "save_rule":
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以调整采购包供应商规则"}), 403
            result = lot_supplier_risk.save_lot_rule(
                db, project, lot, data.get("minimum_supplier_override"),
                data.get("override_basis"), session.get("user_id"),
            )
            db.session.commit()
            return jsonify(result)
        if action:
            return jsonify({"error": "不支持的采购包操作"}), 400
        for field in ("lot_number", "lot_name", "notes"):
            if field in data:
                setattr(lot, field, str(data[field] or "").strip())
        if "budget" in data:
            lot.budget = data.get("budget")
        if not lot.lot_number or not lot.lot_name:
            return jsonify({"error": "包号和包名不能为空"}), 400
        db.session.commit()
        return jsonify(lot.to_dict())
    except lot_supplier_risk.ValidationError as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400
    except Exception:
        db.session.rollback()
        app.logger.exception("lot update failed")
        return jsonify({"error": "采购包保存失败"}), 500


def api_delete_lot(ctx: Any, pid: int, lid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    ProjectLot = ctx.get("ProjectLot")
    _ensure_project_resource = ctx.get("_ensure_project_resource")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    project = db.get_or_404(Project, pid)
    lot = _ensure_project_resource(db.get_or_404(ProjectLot, lid), pid)
    check_scope = getattr(ctx.get("app"), "extensions", {}).get("special_result_lot_used")
    if check_scope and check_scope(pid, lid):
        return jsonify({"error": "该采购包已有特殊结果记录，不能删除"}), 409
    if any(getattr(registration, "lot_id", None) == lid for registration in project.registrations):
        return jsonify({"error": "该采购包已有报名记录，不能删除"}), 400
    db.session.delete(lot)
    db.session.commit()
    return jsonify({"ok": True})
