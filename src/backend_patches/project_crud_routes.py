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


def api_delete_project(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    _cleanup_project_files = ctx.get("_cleanup_project_files")
    _delete_attachment_file = ctx.get("_delete_attachment_file")
    app = ctx.get("app")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    project = db.get_or_404(Project, pid)
    attachments = list(project.attachments.all())
    try:
        if callable(getattr(db.session, 'execute', None)):
            try:import no_deposit_workflow
            except ModuleNotFoundError:from src.backend_patches import no_deposit_workflow
            no_deposit_workflow.cleanup_deleted_project(db, pid)
        db.session.delete(project)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    for attachment in attachments:
        try:
            _delete_attachment_file(attachment)
        except Exception as error:
            app.logger.warning(
                f"删除项目附件物理文件失败: att_id={attachment.id}, {error}"
            )
    try:
        _cleanup_project_files(pid)
    except Exception as error:
        app.logger.warning(f"清理已删除项目文件失败: project_id={pid}, {error}")
    return jsonify({"ok": True})


def api_delete_attachment(ctx: Any, aid: int):
    ctx = _ctx(ctx)
    Attachment = ctx.get("Attachment")
    UPLOAD_FOLDER = ctx.get("UPLOAD_FOLDER")
    _validate_file_path = ctx.get("_validate_file_path")
    app = ctx.get("app")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    try:
        attachment = Attachment.query.get(aid)
        if not attachment:
            return jsonify({"error": "附件不存在，可能已被删除"}), 404
        file_path, filename, project_id = attachment.file_path, attachment.filename, attachment.project_id
        file_full_path = UPLOAD_FOLDER / file_path
        _validate_file_path(file_full_path, file_path)
        db.session.delete(attachment)
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        app.logger.error(f"删除附件失败 aid={aid}: {error}")
        return jsonify({"error": "删除失败，请重试"}), 500
    try:
        if file_full_path.exists():
            file_full_path.unlink()
        else:
            app.logger.warning(f"文件不存在，跳过物理删除: aid={aid}")
    except Exception as error:
        app.logger.warning(f"删除文件失败: {error}")
    try:
        log_operation("delete_attachment", "project", project_id, f"删除附件：{filename}")
    except Exception as error:
        app.logger.warning(f"附件删除日志写入失败: aid={aid}, {error}")
    return jsonify({"ok": True, "message": f"{filename} 已成功删除"})


def api_delete_complaint(ctx: Any, pid: int, cid: int):
    ctx = _ctx(ctx)
    Complaint = ctx.get("Complaint")
    UPLOAD_FOLDER = ctx.get("UPLOAD_FOLDER")
    _ensure_project_resource = ctx.get("_ensure_project_resource")
    _validate_file_path = ctx.get("_validate_file_path")
    app = ctx.get("app")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    complaint = _ensure_project_resource(db.get_or_404(Complaint, cid), pid)
    paths = [(attachment.id, attachment.file_path) for attachment in complaint.attachments]
    legacy_path = complaint.attachment_path
    try:
        db.session.delete(complaint)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    if legacy_path:
        paths.append((None, legacy_path))
    for attachment_id, relative_path in paths:
        try:
            path = UPLOAD_FOLDER / relative_path
            _validate_file_path(path, relative_path)
            if path.exists():
                path.unlink()
        except Exception as error:
            app.logger.warning(f"删除质疑附件物理文件失败: att_id={attachment_id}, {error}")
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
        paths = [attachment.file_path for attachment in list(event.attachments)]
        try:
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
        attachments = list(item.attachments)
        project = item.project
        try:
            db.session.delete(item)
            db.session.flush()
            _recalculate_clarification_deadline(project, fallback)
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        for attachment in attachments:
            try:
                _delete_attachment_file(attachment)
            except Exception as error:
                app.logger.warning("删除澄清附件失败: %s", error)
        return jsonify({"ok": True})
    data = request.get_json() or {}
    _apply_clarification_data(item, data, pid)
    _recalculate_clarification_deadline(item.project, fallback)
    db.session.commit()
    return jsonify(item.to_dict())


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
        from . import lot_supplier_risk
    except ImportError:
        import lot_supplier_risk
    try:
        try:
            from . import stage_workflow
        except ImportError:
            import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow
    try:
        try:
            from . import stage_templates
        except ImportError:
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
    projects = Project.query.options(*project_options).order_by(
        Project.year.desc(), Project.number
    ).all()
    settings = load_app_settings()
    current = datetime.now()
    def serialize_summary(project):
        summary = dict(project.to_summary_dict())
        for field in ("created_at", "completed_at"):
            value = getattr(project, field, None)
            if value is not None:
                summary[field] = value.isoformat() if hasattr(value, "isoformat") else str(value)
        return lot_supplier_risk.enrich_project_payload(
            db,
            stage_templates.serialize_v5_project_payload(
                db.session,
                text,
                project,
                summary,
                settings,
                ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
                ctx.get("STAGES", []),
            ) if ctx.get("_PROCUREMENT_CATALOG_ENABLED") or settings.get("stage_templates") or getattr(project, "method", "") == "网上竞价" else stage_workflow.apply_project_payload(
                summary, settings, ctx.get("STAGES", [])
            ),
            project,
            current,
            settings,
        )

    return jsonify([
        stage_templates.enrich_stage_locations(db.session, text, project.id, serialize_summary(project))
        for project in projects
    ])


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
        from . import lot_supplier_risk
    except ImportError:
        import lot_supplier_risk
    try:
        try:
            from . import stage_workflow
        except ImportError:
            import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow
    try:
        try:
            from . import stage_templates
        except ImportError:
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
        for pid in ids:
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
    if any(getattr(registration, "lot_id", None) == lid for registration in project.registrations):
        return jsonify({"error": "该采购包已有报名记录，不能删除"}), 400
    db.session.delete(lot)
    db.session.commit()
    return jsonify({"ok": True})
