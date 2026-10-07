"""Replacement Flask view bodies compiled into the packaged ``app`` module."""


def save_app_settings(settings):
    import json
    import os
    import tempfile
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates
    with stage_templates.settings_write_lock:
        if SETTINGS_PATH.exists():
            try:
                existing = json.loads(SETTINGS_PATH.read_text(encoding='utf-8'))
                if not isinstance(existing, dict):
                    raise ValueError('settings must be an object')
            except (ValueError, UnicodeError) as error:
                raise ValueError(f'系统设置文件损坏，原文件已保留：{SETTINGS_PATH}；请从备份恢复设置后重试') from error
        current = load_app_settings()
        current.update(settings)
        payload = json.dumps(current, ensure_ascii=False, indent=2)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=SETTINGS_PATH.parent,
                                             prefix=SETTINGS_PATH.name+'.', suffix='.tmp', delete=False) as stream:
                temporary = stream.name
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, SETTINGS_PATH)
        finally:
            if temporary is not None:
                from pathlib import Path
                Path(temporary).unlink(missing_ok=True)
        return current


def api_projects():
    import lot_supplier_risk
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
                globals().get("METHODS", stage_templates.PROCUREMENT_METHODS),
                globals().get("STAGES", []),
            ) if settings.get("stage_templates") or getattr(project, "method", "") == "网上竞价" else stage_workflow.apply_project_payload(
                summary, settings, globals().get("STAGES", [])
            ),
            project,
            current,
            settings,
        )

    return jsonify([serialize_summary(project) for project in projects])


def api_project(pid):
    import lot_supplier_risk
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
            globals().get("METHODS", stage_templates.PROCUREMENT_METHODS),
            globals().get("STAGES", []),
        ) if settings.get("stage_templates") or getattr(project, "method", "") == "网上竞价" else stage_workflow.apply_project_payload(
            project.to_dict(), settings, globals().get("STAGES", [])
        ),
        project,
        datetime.now(),
        settings,
    )
    return jsonify(stage_templates.enrich_stage_locations(db.session, text, pid, payload))


def api_update_stage(pid, stage_key):
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates
    p = Project.query.options(joinedload(Project.stages)).filter_by(id=pid).first_or_404()
    if p.is_terminated:
        return jsonify({"error": "项目已关闭，无法修改阶段"}), 400
    s = p.get_stage(stage_key)
    if s is None:
        return jsonify({"error": "阶段不存在"}), 404
    data = request.get_json() or {}
    if not isinstance(data, dict):
        return jsonify({"error": "阶段数据格式错误"}), 400
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
    if "completed" in data:
        s.completed = bool(data["completed"])
        if s.completed:
            if data.get("completed_date"):
                try:
                    s.completed_date = date.fromisoformat(data["completed_date"])
                except (TypeError, ValueError):
                    s.completed_date = date.today()
            elif not s.completed_date:
                s.completed_date = date.today()
        else:
            s.completed_date = None
    if data.get("completed_date") and s.completed:
        try:
            s.completed_date = date.fromisoformat(data["completed_date"])
        except (TypeError, ValueError):
            pass
    if "planned_at" in data:
        value = data["planned_at"]
        try:
            s.planned_datetime = datetime.fromisoformat(value) if value else None
        except (TypeError, ValueError):
            s.planned_datetime = None
    if "skipped" in data:
        new_skip = bool(data["skipped"])
        if new_skip != s.skipped:
            s.skipped = new_skip
            if new_skip:
                s.completed = True
                s.completed_date = date.today()
    if "notes" in data:
        s.notes = data["notes"]
    if "responsible_person" in data:
        s.responsible_person = data["responsible_person"] or ""
    if venues:
        stage_templates.ensure_v5_snapshot_schema(db.session, text)
        for field, value in venues.items():
            db.session.execute(text(f"UPDATE stages SET {field}=:value WHERE project_id=:pid AND stage_key=:key"),
                               {"value": value, "pid": pid, "key": stage_key})
    db.session.commit()
    if data.get("completed") and s.completed:
        stage_name = next((row["name"] for row in STAGES if row["key"] == stage_key), stage_key)
        import json
        log_operation("complete_stage", "stage", s.id,
                      f"完成阶段：{p.number} - {stage_name}",
                      json.dumps({"project_id": p.id, "stage_key": stage_key, "date": str(s.completed_date)}, ensure_ascii=False))
    return jsonify(stage_templates.enrich_stage_locations(db.session, text, pid, p.to_dict()))


def api_create_project():
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates
    try:
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
    methods = globals().get("METHODS", stage_templates.PROCUREMENT_METHODS)
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
    definitions = globals().get("STAGES", [])
    template = stage_templates.initialize_project_workflow(
        db.session, text, project, settings, methods, definitions,
        enroll_online_bidding=True,
    )

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


def api_get_lots(pid):
    project = db.get_or_404(Project, pid)
    return jsonify([lot.to_dict() for lot in project.lots])


def api_create_lot(pid):
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
        db.session.commit()
        return jsonify(lot.to_dict()), 201
    except lot_supplier_risk.ValidationError as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400
    except Exception:
        db.session.rollback()
        app.logger.exception("lot create failed")
        return jsonify({"error": "采购包保存失败"}), 500


def api_update_lot(pid, lid):
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


def api_delete_lot(pid, lid):
    project = db.get_or_404(Project, pid)
    lot = _ensure_project_resource(db.get_or_404(ProjectLot, lid), pid)
    if any(getattr(registration, "lot_id", None) == lid for registration in project.registrations):
        return jsonify({"error": "该采购包已有报名记录，不能删除"}), 400
    db.session.delete(lot)
    db.session.commit()
    return jsonify({"ok": True})


def login_required(f):
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            if request.path.startswith("/api/"):
                return jsonify({"error": "请先登录"}), 401
            return redirect("/login")
        user = db.session.get(User, user_id)
        if not user or not user.is_active:
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"error": "账号已停用，请重新登录"}), 401
            return redirect("/login")
        session["username"] = user.username
        session["is_admin"] = bool(user.is_admin)

        import project_activity

        method = str(getattr(request, "method", "GET") or "GET").upper()
        path = str(getattr(request, "path", "") or "")
        payload = request.get_json(silent=True) or {}
        descriptor = project_activity.classify_project_write(method, path, payload)
        def project_snapshot(project_id):
            project = db.session.get(Project, project_id)
            if project is not None:
                if hasattr(project, "to_dict"):
                    return dict(project.to_dict())
                return {
                        "id": getattr(project, "id", project_id),
                        "number": getattr(project, "number", ""),
                        "name": getattr(project, "name", ""),
                }
            return None

        try:
            project_ids = []
            if descriptor is not None and descriptor.project_id is not None:
                project_ids = [descriptor.project_id]
            elif descriptor is not None and descriptor.action == "stage.batch_advance":
                project_ids = [
                    int(value)
                    for value in payload.get("project_ids", [])
                    if str(value).isdigit()
                ]
            elif descriptor is not None and descriptor.target_type == "attachment":
                attachment_id = descriptor.target_id
                attachment = (
                    db.session.get(Attachment, int(attachment_id))
                    if attachment_id is not None and str(attachment_id).isdigit()
                    else None
                )
                if attachment is not None and getattr(attachment, "project_id", None):
                    project_ids = [int(attachment.project_id)]

            if descriptor is None:
                captures = []
            elif project_ids:
                captures = [
                    project_activity.capture_before_write(
                        project_activity.descriptor_for_project(
                            descriptor, project_id
                        ),
                        payload,
                        project_snapshot(project_id),
                    )
                    for project_id in dict.fromkeys(project_ids)
                ]
            else:
                captures = [
                    project_activity.capture_before_write(descriptor, payload, None)
                ]
        except Exception:
            app.logger.exception("project activity capture failed")
            captures = []

        response = f(*args, **kwargs)
        if not captures:
            return response
        status = getattr(response, "status_code", None)
        if status is None and isinstance(response, tuple) and len(response) > 1:
            status = response[1] if isinstance(response[1], int) else None
        status = int(status or 200)
        if status < 200 or status >= 400:
            return response

        raw_payload = response[0] if isinstance(response, tuple) else response
        if isinstance(raw_payload, dict):
            response_payload = raw_payload
        elif hasattr(raw_payload, "get_json"):
            response_payload = raw_payload.get_json(silent=True) or {}
        else:
            response_payload = {}
        for capture in captures:
            resolved_project_id = (
                capture.descriptor.project_id or response_payload.get("id")
            )
            try:
                project_after = (
                    project_snapshot(resolved_project_id)
                    if resolved_project_id is not None
                    else None
                )
                project_activity.record_activity(
                    db,
                    OperationLog,
                    actor={"id": user.id, "username": user.username},
                    request_meta={"ip_address": getattr(request, "remote_addr", "")},
                    capture=capture,
                    response_payload=response_payload,
                    project_snapshot=project_after,
                )
            except Exception:
                app.logger.exception("project activity audit failed")
        return response

    return decorated


def supplier_registration_to_dict(self):
    import consortium_registration

    consortium_contract = (
        "bidder_type",
        "consortium_members",
        "registration_consortium_members",
    )
    payload = {
        "id": self.id,
        "project_id": self.project_id,
        "lot_id": self.lot_id,
        "lot_number": self.lot.lot_number if self.lot else "",
        "lot_name": self.lot.lot_name if self.lot else "",
        "company_name": self.company_name,
        "company_address": self.company_address,
        "legal_representative": self.legal_representative,
        "bid_manager": self.bid_manager,
        "manager_phone": self.manager_phone,
        "manager_email": self.manager_email,
        "acquisition_date": (
            self.acquisition_date.isoformat() if self.acquisition_date else None
        ),
        "notes": self.notes,
        "registration_method": self.registration_method or "线上报名",
        "attachments": sorted(
            (attachment.to_dict() for attachment in self.attachments),
            key=lambda item: item.get("uploaded_at") or "",
        ),
    }
    if not consortium_contract:
        raise RuntimeError("consortium serializer contract is unavailable")
    return consortium_registration.enrich_registration(db, payload)


def api_get_registrations(pid):
    def _build_registration_xlsx(records):
        """Build an .xlsx (SpreadsheetML) for a list of registration dicts.

        ``records`` is a list of dicts conforming to ``supplier_registration_to_dict``
        output (each with company_name / lot_number / bid_manager / manager_phone /
        manager_email / acquisition_date / registration_method / attachments).
        Returns the raw xlsx bytes and the display filename.
        """
        from io import BytesIO
        from datetime import datetime
        from urllib.parse import quote
        from xml.sax.saxutils import escape
        from zipfile import ZIP_DEFLATED, ZipFile
        import signed_attachments

        base_url = str(getattr(request, "host_url", "") or "").rstrip("/")
        if "127.0.0.1" in base_url or "localhost" in base_url:
            try:
                import socket

                probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                try:
                    probe.connect(("10.255.255.255", 1))
                    local_ip = probe.getsockname()[0]
                except Exception:
                    local_ip = socket.gethostbyname(socket.gethostname())
                finally:
                    probe.close()
                if local_ip and not local_ip.startswith("127."):
                    host_str = str(getattr(request, "host", "") or "")
                    port = host_str.split(":")[-1] if ":" in host_str else "5001"
                    base_url = f"http://{local_ip}:{port}"
            except Exception:
                pass
        generated_at = datetime.now()
        expires_at = int(generated_at.timestamp()) + 7 * 24 * 60 * 60
        secret = None
        attachment_catalog = []

        headers = [
            "序号",
            "项目编号",
            "项目名称",
            "年度",
            "所属包号",
            "投标主体类型",
            "公司名称/联合体牵头单位",
            "联合体成员",
            "报名方式",
            "公司地址",
            "法定代表人",
            "投标负责人",
            "手机号",
            "电子邮箱",
            "获取日期",
            "备注",
            "附件数量",
            "首个附件链接",
        ]
        widths = [6, 20, 34, 9, 12, 14, 30, 34, 14, 28, 16, 16, 18, 26, 14, 30, 10, 46]

        def cell_ref(column, row):
            letters = ""
            while column:
                column, remainder = divmod(column - 1, 26)
                letters = chr(65 + remainder) + letters
            return f"{letters}{row}"

        def xml_text(value):
            text = "" if value is None else str(value)
            text = "".join(
                character
                for character in text
                if ord(character) in (0x09, 0x0A, 0x0D)
                or 0x20 <= ord(character) <= 0xD7FF
                or 0xE000 <= ord(character) <= 0xFFFD
                or 0x10000 <= ord(character) <= 0x10FFFF
            )
            return escape(text)

        def cell_xml(row, column, value, style):
            attributes = f' r="{cell_ref(column, row)}" s="{style}"'
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return f"<c{attributes}><v>{value}</v></c>"
            text = "" if value is None else str(value)
            if not text:
                return f"<c{attributes}/>"
            if text.startswith("HYPERLINK::"):
                parts = text.split("::", 2)
                if len(parts) == 3:
                    url_formula = parts[1].replace('"', '""')
                    display_formula = parts[2].replace('"', '""')
                    formula = f'HYPERLINK("{url_formula}", "{display_formula}")'
                    return f'<c{attributes}><f>{xml_text(formula)}</f></c>'
            preserve = ' xml:space="preserve"' if text != text.strip() else ""
            return f'<c{attributes} t="inlineStr"><is><t{preserve}>{xml_text(text)}</t></is></c>'

        rows_xml = []
        for index, record in enumerate(records, start=1):
            attachments = record.get("attachments") or []
            signed_links = []
            for attachment in attachments:
                attachment_id = attachment.get("id")
                if attachment_id is None:
                    continue
                if secret is None:
                    secret = signed_attachments.get_or_create_secret(DATA_DIR)
                url = signed_attachments.build_signed_url(
                    base_url, attachment_id, expires_at, secret
                )
                signed_links.append(url)
                attachment_catalog.append(
                    {
                        "project_number": record.get("project_number", "") or "",
                        "project_name": record.get("project_name", "") or "",
                        "company_name": record.get("company_name", "") or "",
                        "filename": attachment.get("filename", "") or f"附件{attachment_id}",
                        "expires_at": datetime.fromtimestamp(expires_at).strftime("%Y-%m-%d %H:%M:%S"),
                        "url": url,
                    }
                )
            members = record.get("consortium_members") or []
            member_text = "；".join(
                str(member.get("company_name", "") or "").strip()
                for member in members
                if isinstance(member, dict) and str(member.get("company_name", "") or "").strip()
            )
            bidder_type = "联合体" if record.get("bidder_type") == "consortium" else "单独投标"
            first_link = (
                f"HYPERLINK::{signed_links[0]}::{attachments[0].get('filename') or '下载附件'}"
                if signed_links
                else ""
            )
            values = [
                index,
                record.get("project_number", "") or "",
                record.get("project_name", "") or "",
                record.get("project_year", "") or "",
                record.get("lot_number", "") or "",
                bidder_type,
                record.get("company_name", "") or "",
                member_text,
                record.get("registration_method", "") or "线上报名",
                record.get("company_address", "") or "",
                record.get("legal_representative", "") or "",
                record.get("bid_manager", "") or "",
                record.get("manager_phone", "") or "",
                record.get("manager_email", "") or "",
                record.get("acquisition_date", "") or "",
                record.get("notes", "") or "",
                len(signed_links),
                first_link,
            ]
            style = 5 if index % 2 else 0
            cells = "".join(
                cell_xml(index + 4, column, value, style)
                for column, value in enumerate(values, 1)
            )
            rows_xml.append(f'<row r="{index + 4}">{cells}</row>')

        title = "供应商报名清单"
        metadata = (
            f"导出时间：{generated_at.strftime('%Y-%m-%d %H:%M:%S')}    "
            f"报名记录数：{len(records)}"
        )
        sheet_rows = [
            f'<row r="1">{cell_xml(1, 1, title, 1)}</row>',
            f'<row r="2">{cell_xml(2, 1, metadata, 2)}</row>',
            f'<row r="4">{"".join(cell_xml(4, column, header, 3) for column, header in enumerate(headers, 1))}</row>',
        ]
        if rows_xml:
            sheet_rows.extend(rows_xml)
            last_row = 4 + len(records)
            merges = '<mergeCell ref="A1:R1"/><mergeCell ref="A2:R2"/>'
        else:
            sheet_rows.append(f'<row r="5">{cell_xml(5, 1, "暂无报名记录", 4)}</row>')
            last_row = 5
            merges = '<mergeCell ref="A1:R1"/><mergeCell ref="A2:R2"/><mergeCell ref="A5:R5"/>'

        cols = "".join(
            f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
            for index, width in enumerate(widths, 1)
        )
        sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
      <cols>{cols}</cols>
      <sheetData>{"".join(sheet_rows)}</sheetData>
      <autoFilter ref="A4:R{last_row}"/>
      <mergeCells count="{3 if not records else 2}">{merges}</mergeCells>
    </worksheet>'''
        catalog_headers = [
            "项目编号",
            "项目名称",
            "报名公司",
            "附件文件名",
            "链接到期时间",
            "下载链接",
        ]
        catalog_rows = [
            '<row r="1">'
            + "".join(
                cell_xml(1, column, header, 3)
                for column, header in enumerate(catalog_headers, 1)
            )
            + "</row>"
        ]
        for catalog_index, item in enumerate(attachment_catalog, start=2):
            values = [
                item["project_number"],
                item["project_name"],
                item["company_name"],
                item["filename"],
                item["expires_at"],
                f'HYPERLINK::{item["url"]}::下载',
            ]
            catalog_rows.append(
                f'<row r="{catalog_index}">'
                + "".join(
                    cell_xml(catalog_index, column, value, 0)
                    for column, value in enumerate(values, 1)
                )
                + "</row>"
            )
        if not attachment_catalog:
            catalog_rows.append(
                '<row r="2">' + cell_xml(2, 1, "暂无附件", 0) + "</row>"
            )
        sheet2_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>{"".join(catalog_rows)}</sheetData>
    </worksheet>'''
        styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="2"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts>
      <fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7FBF9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor indexed="64"/></patternFill></fill></fills>
      <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>'''
        content_types_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'''
        package_relationships_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'''
        workbook_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="供应商报名" sheetId="1" r:id="rId1"/><sheet name="附件清单" sheetId="2" r:id="rId3"/></sheets></workbook>'''
        workbook_relationships_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'''
        app_properties_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Project Management System</Application></Properties>'''
        core_properties_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Project Management System</dc:creator><cp:lastModifiedBy>Project Management System</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">{generated_at.strftime('%Y-%m-%dT%H:%M:%SZ')}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{generated_at.strftime('%Y-%m-%dT%H:%M:%SZ')}</dcterms:modified></cp:coreProperties>'''

        output = BytesIO()
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", content_types_xml)
            archive.writestr("_rels/.rels", package_relationships_xml)
            archive.writestr("docProps/app.xml", app_properties_xml)
            archive.writestr("docProps/core.xml", core_properties_xml)
            archive.writestr("xl/workbook.xml", workbook_xml)
            archive.writestr("xl/_rels/workbook.xml.rels", workbook_relationships_xml)
            archive.writestr("xl/styles.xml", styles_xml)
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
            archive.writestr("xl/worksheets/sheet2.xml", sheet2_xml)
        return output.getvalue()
    def _export_registrations_xlsx(pid):
        """Handle ?export=1 for /api/projects/<pid>/registrations.

        Supports scope=current (default) and scope=all (across projects, optional
        year= filter). With save=1 the workbook is written to the export
        directory and a JSON summary is returned (desktop flow).
        """
        from datetime import date, datetime
        from urllib.parse import quote

        scope = request.args.get("scope", "current")
        selected_year = request.args.get("year", "").strip()

        registrations = []
        current_project = None
        if scope == "all":
            query = SupplierRegistration.query.join(Project, SupplierRegistration.project_id == Project.id)
            if selected_year:
                query = query.filter(Project.year == selected_year)
            registrations = query.order_by(Project.year.desc(), Project.number.desc()).all()
        else:
            current_project = db.get_or_404(Project, pid)
            registrations = list(getattr(current_project, "registrations", None) or [])

        records = []
        for registration in registrations:
            record = dict(registration.to_dict())
            project = current_project or getattr(registration, "project", None)
            record["project_number"] = getattr(project, "number", "") or ""
            record["project_name"] = getattr(project, "name", "") or ""
            record["project_year"] = getattr(project, "year", "") or ""
            records.append(record)
        workbook_bytes = _build_registration_xlsx(records)

        today = date.today()
        if scope == "all":
            ascii_year = "all" if not selected_year else str(selected_year)
            filename = f"全部项目报名_{ascii_year}_{today.strftime('%Y%m%d')}.xlsx"
        else:
            filename = f"供应商报名_{today.strftime('%Y%m%d')}.xlsx"

        def contained_registration_path(export_dir, name):
            resolved_export_dir = export_dir.resolve()
            output_path = export_dir / name
            resolved_output_path = output_path.resolve()
            if resolved_export_dir not in resolved_output_path.parents:
                raise ValueError("export path must remain inside the export directory")
            return output_path

        if request.args.get("save") == "1":
            export_dir = get_export_dir()
            export_dir.mkdir(parents=True, exist_ok=True)
            output_path = contained_registration_path(export_dir, filename)
            if output_path.exists():
                collision_name = (
                    f"供应商报名_{today.strftime('%Y%m%d')}"
                    f"_{datetime.now().strftime('%H%M%S')}.xlsx"
                )
                output_path = contained_registration_path(export_dir, collision_name)
            output_path.write_bytes(workbook_bytes)
            log_operation(
                "export_registrations",
                "project",
                pid,
                f"导出供应商报名（{len(records)}条）",
            )
            return jsonify(
                {
                    "message": "供应商报名已导出",
                    "filename": output_path.name,
                    "path": str(output_path),
                    "folder": str(export_dir),
                    "count": len(records),
                }
            )

        ascii_filename = f"supplier_registrations_{today.strftime('%Y%m%d')}.xlsx"
        disposition = (
            f'attachment; filename="{ascii_filename}"; '
            f"filename*=UTF-8''{quote(filename)}"
        )
        return app.response_class(
            workbook_bytes,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": disposition},
        )

    import consortium_registration

    try:
        if request.args.get("export") == "1":
            return _export_registrations_xlsx(pid)
        consortium_registration.ensure_schema(db)
        project = db.get_or_404(Project, pid)
        return jsonify([registration.to_dict() for registration in project.registrations])
    except Exception as error:
        if getattr(error, "code", None):
            raise
        app.logger.exception("registration list failed")
        return jsonify({"error": "读取报名登记失败"}), 500
def api_create_registration(pid):
    import consortium_registration

    consortium_registration.registration_write_lock.acquire()
    try:
        consortium_registration.ensure_schema(db)
        project = db.get_or_404(Project, pid)
        if project.is_terminated:
            return jsonify({"error": "项目已关闭"}), 400
        data = request.get_json() or {}
        if len(list(getattr(project, "lots", None) or [])) > 1 and not data.get("lot_id"):
            return jsonify({"error": "多包项目的报名必须选择所属包"}), 400
        normalized = consortium_registration.validate_payload(data)
        effective_lot_id = _normalize_project_lot_id(data.get("lot_id"), pid)
        if consortium_registration.find_existing_registration(db, SupplierRegistration, pid, normalized["company_name"], effective_lot_id):
            return jsonify({"error": "该供应商已在本项目的所选采购包报名，请编辑已有记录"}), 409
        acquisition_date = None
        if data.get("acquisition_date"):
            try:
                acquisition_date = date.fromisoformat(data["acquisition_date"])
            except (TypeError, ValueError):
                return jsonify({"error": "获取日期格式无效"}), 400
        registration = SupplierRegistration(
            project_id=pid,
            lot_id=_normalize_project_lot_id(data.get("lot_id"), pid),
            company_name=normalized["company_name"],
            company_address=data.get("company_address", ""),
            legal_representative=data.get("legal_representative", ""),
            bid_manager=data.get("bid_manager", ""),
            manager_phone=data.get("manager_phone", ""),
            manager_email=data.get("manager_email", ""),
            acquisition_date=acquisition_date,
            notes=data.get("notes", ""),
            registration_method=data.get("registration_method", "线上报名"),
        )
        db.session.add(registration)
        db.session.flush()
        consortium_registration.replace_members(
            db,
            registration.id,
            normalized["bidder_type"],
            normalized["consortium_members"],
        )
        db.session.commit()
        return jsonify(registration.to_dict()), 201
    except consortium_registration.ValidationError as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        db.session.rollback()
        if getattr(error, "code", None):
            raise
        app.logger.exception("registration create failed")
        return jsonify({"error": "报名登记保存失败"}), 500
    finally:
        consortium_registration.registration_write_lock.release()


def api_update_registration(pid, rid):
    import consortium_registration

    consortium_registration.registration_write_lock.acquire()
    try:
        consortium_registration.ensure_schema(db)
        registration = _ensure_project_resource(
            db.get_or_404(SupplierRegistration, rid), pid
        )
        data = request.get_json() or {}
        project = db.get_or_404(Project, pid)
        effective_lot_id = data.get("lot_id", getattr(registration, "lot_id", None))
        if len(list(getattr(project, "lots", None) or [])) > 1 and not effective_lot_id:
            return jsonify({"error": "多包项目的报名必须选择所属包"}), 400
        current = consortium_registration.enrich_registration(
            db, {"id": registration.id}
        )
        normalized = consortium_registration.validate_payload(
            {
                "bidder_type": data.get("bidder_type", current["bidder_type"]),
                "company_name": data.get("company_name", registration.company_name),
                "consortium_members": data.get(
                    "consortium_members", current["consortium_members"]
                ),
            },
            current_type=current["bidder_type"],
        )
        effective_lot_id = _normalize_project_lot_id(effective_lot_id, pid)
        if consortium_registration.find_existing_registration(db, SupplierRegistration, pid, normalized["company_name"], effective_lot_id, exclude_id=rid):
            return jsonify({"error": "该供应商已在本项目的所选采购包报名，请编辑已有记录"}), 409
        if "lot_id" in data:
            registration.lot_id = _normalize_project_lot_id(data.get("lot_id"), pid)
        registration.company_name = normalized["company_name"]
        for field in (
            "company_address",
            "legal_representative",
            "bid_manager",
            "manager_phone",
            "manager_email",
            "notes",
            "registration_method",
        ):
            if field in data:
                setattr(registration, field, data[field])
        if "acquisition_date" in data:
            try:
                registration.acquisition_date = (
                    date.fromisoformat(data["acquisition_date"])
                    if data["acquisition_date"]
                    else None
                )
            except (TypeError, ValueError):
                db.session.rollback()
                return jsonify({"error": "获取日期格式无效"}), 400
        consortium_registration.replace_members(
            db,
            registration.id,
            normalized["bidder_type"],
            normalized["consortium_members"],
        )
        db.session.commit()
        return jsonify(registration.to_dict())
    except consortium_registration.ValidationError as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        db.session.rollback()
        if getattr(error, "code", None):
            raise
        app.logger.exception("registration update failed")
        return jsonify({"error": "报名登记保存失败"}), 500
    finally:
        consortium_registration.registration_write_lock.release()


def api_delete_registration(pid, rid):
    import consortium_registration

    try:
        consortium_registration.ensure_schema(db)
        registration = _ensure_project_resource(
            db.get_or_404(SupplierRegistration, rid), pid
        )
        for attachment in registration.attachments:
            try:
                file_path = UPLOAD_FOLDER / attachment.file_path
                _validate_file_path(file_path, attachment.file_path)
                if file_path.exists():
                    file_path.unlink()
                else:
                    app.logger.warning(
                        f"文件不存在，仅清理数据库记录: att_id={attachment.id}"
                    )
            except Exception as error:
                app.logger.warning(
                    f"删除报名附件文件失败: att_id={attachment.id}, {error}"
                )
        consortium_registration.delete_members(db, registration.id)
        db.session.delete(registration)
        db.session.commit()
        return jsonify({"ok": True})
    except Exception as error:
        db.session.rollback()
        if getattr(error, "code", None):
            raise
        app.logger.exception("registration delete failed")
        return jsonify({"error": "删除报名登记失败"}), 500


def api_get_settings():
    try:
        import stage_templates as settings_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates as settings_templates
    with settings_templates.settings_write_lock:
        import ipaddress
        import json
        import os
        import sys
        import winreg
        try:
            import reminder_routing
        except ModuleNotFoundError:
            from src.backend_patches import reminder_routing
        try:
            import stage_workflow
        except ModuleNotFoundError:
            from src.backend_patches import stage_workflow
        try:
            import stage_templates
        except ModuleNotFoundError:
            from src.backend_patches import stage_templates

        if request.args.get("project_activity_view", "").strip() == "recent":
            import project_activity

            try:
                result = project_activity.read_activity(
                    db,
                    OperationLog,
                    User,
                    viewer={
                        "id": session.get("user_id"),
                        "is_admin": bool(session.get("is_admin")),
                    },
                    limit=request.args.get("limit", 30),
                    before_id=request.args.get("before_id"),
                    user_id=request.args.get("user_id"),
                    project_id=request.args.get("project_id"),
                    action=request.args.get("action"),
                )
                return jsonify(result)
            except ValueError as error:
                return jsonify({"error": str(error)}), 400
            except Exception:
                app.logger.exception("project activity read failed")
                return jsonify({"error": "读取项目操作记录失败"}), 500

        if request.args.get("purchaser_board_view", "").strip() == "bootstrap":
            import purchaser_classification

            try:
                result = purchaser_classification.read_purchaser_board(
                    DB_PATH,
                    DATA_DIR / "backups",
                    bool(session.get("is_admin")),
                    connect_encrypted,
                    MASTER_KEY,
                )
                return jsonify(result)
            except Exception:
                return jsonify({"error": "读取采购人分类看板失败"}), 500

        if not session.get("is_admin"):
            return jsonify({"is_desktop": bool(app.config.get("IS_DESKTOP"))})

        credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")
        pending_path = credential_path.with_suffix(credential_path.suffix + ".tmp")
        credential_rollback_path = credential_path.with_suffix(
            credential_path.suffix + ".rollback"
        )
        settings_rollback_path = SETTINGS_PATH.with_name(
            SETTINGS_PATH.name + ".reminder-rollback"
        )
        transaction_path = SETTINGS_PATH.with_name("reminder_settings_transaction.json")
        if transaction_path.is_file():
            recovery_temporary = SETTINGS_PATH.with_name(
                SETTINGS_PATH.name + ".reminder-recovery"
            )
            credential_recovery_temporary = credential_path.with_suffix(
                credential_path.suffix + ".recovery"
            )
            try:
                transaction = json.loads(transaction_path.read_text(encoding="utf-8"))
                if transaction.get("version") != 1:
                    raise ValueError("unsupported reminder settings transaction")
                if pending_path.is_file():
                    if transaction.get("settings_existed"):
                        recovery_temporary.write_bytes(settings_rollback_path.read_bytes())
                        os.replace(recovery_temporary, SETTINGS_PATH)
                    else:
                        SETTINGS_PATH.unlink(missing_ok=True)
                    if transaction.get("mode") == "clear":
                        if transaction.get("credential_existed"):
                            credential_recovery_temporary.write_bytes(
                                credential_rollback_path.read_bytes()
                            )
                            os.replace(credential_recovery_temporary, credential_path)
                        else:
                            credential_path.unlink(missing_ok=True)
                    pending_path.unlink(missing_ok=True)
                settings_rollback_path.unlink(missing_ok=True)
                credential_rollback_path.unlink(missing_ok=True)
                transaction_path.unlink()
            except Exception:
                recovery_temporary.unlink(missing_ok=True)
                credential_recovery_temporary.unlink(missing_ok=True)
                return jsonify({"error": "邮件提醒设置事务恢复失败，自动发送已停止"}), 500

        settings = load_app_settings()
        response = {
            "export_folder": str(get_export_dir()),
            "configured_export_folder": settings.get("export_folder") or "",
            "login_subtitle": settings.get("login_subtitle") or "采购项目管理系统",
            "desktop_export_folder": str(get_desktop_dir() / "项目管理系统导出"),
            "program_export_folder": str((Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(DATA_DIR)) / "exports"),
            "settings_path": str(SETTINGS_PATH),
            "is_desktop": bool(app.config.get("IS_DESKTOP")),
        }
        response["stage_order"] = stage_workflow.normalize_stage_order(
            settings.get("stage_order"),
            globals().get("STAGES", []),
            warn=getattr(getattr(app, "logger", None), "warning", None),
        )
        response["stage_templates"] = stage_templates.normalize_stage_templates(
            settings.get("stage_templates"),
            globals().get("METHODS", stage_templates.PROCUREMENT_METHODS),
            globals().get("STAGES", []),
            stage_order=response["stage_order"],
            warn=getattr(getattr(app, "logger", None), "warning", None),
            migrate_legacy_auto_completion=settings.get(
                "stage_auto_completion_policy_version"
            ) != 1,
        )
        response["stage_module_catalog"] = stage_templates.module_catalog_payload()
        reminder_defaults = {
            "reminder_enabled": False,
            "reminder_time": "09:00",
            "reminder_subject": "采购执行提醒：{date} 共 {count} 个节点",
            "reminder_advance_days": 0,
            "reminder_weekdays": [0, 1, 2, 3, 4, 5, 6],
            "smtp_host": "",
            "smtp_port": 465,
            "smtp_security": "ssl",
            "smtp_username": "",
            "smtp_sender": "",
            "reminder_recipients": [],
            "reminder_stage_keys": [
                stage["key"]
                for stage in globals().get(
                    "STAGES",
                    [
                        {"key": key}
                        for key in (
                            "project_setup", "procurement_request", "agency_agreement", "document_draft",
                            "doc_review", "announcement", "registration_end", "bid_opening", "evaluation",
                            "result_notice", "winning_notice", "contract", "acceptance", "archive",
                        )
                    ],
                )
            ],
            "reminder_content": {
                "project_number": True,
                "project_name": True,
                "purchaser": True,
                "stage_name": True,
                "planned_at": True,
                "registration_count": True,
            },
            "event_reminder_create_enabled": False,
            "event_reminder_complete_enabled": False,
            "supplier_minimums": {
                "公开招标": 3, "竞争性磋商": 3, "竞争性谈判": 3, "邀请招标": 3,
                "网上竞价": 3, "单一来源": 1, "遴选": 3, "直选": 1,
            },
        }
        for key, default in reminder_defaults.items():
            response[key] = settings.get(key, default)
        try:
            response["reminder_recipient_groups"] = reminder_routing.normalize_recipient_groups(
                settings
            )
        except reminder_routing.RecipientGroupValidationError:
            response["reminder_recipient_groups"] = []
        response["smtp_password_configured"] = credential_path.is_file()
        state_path = SETTINGS_PATH.with_name("reminder_send_log.json")
        reminder_status = {}
        if state_path.is_file():
            try:
                reminder_status = json.loads(state_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                reminder_status = {"last_error": "提醒状态文件无法读取，自动发送已停止"}
        if not isinstance(reminder_status, dict):
            reminder_status = {}
            app.logger.warning('reminder status has invalid structure')
        response["reminder_status"] = {
            key: reminder_status.get(key)
            for key in ("last_check_at", "last_success_at", "last_error", "sent_today")
        }
        if not isinstance(response["reminder_status"]["last_error"], str) or response["reminder_status"]["last_error"] not in reminder_routing.SAFE_ERROR_CODES:
            response["reminder_status"]["last_error"] = None

        def safe_runtime_status(path, event_type):
            from datetime import datetime

            status = {
                "last_check_at": None,
                "last_success_at": None,
                "error_code": None,
                "pending_count": 0,
            }
            if not path.is_file():
                return status
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(value, dict):
                    return status
                nested = value.get("runtime_status")
                source = nested.get(event_type, {}) if isinstance(nested, dict) else value
                if not isinstance(source, dict):
                    return status
                for key in ("last_check_at", "last_success_at"):
                    raw = source.get(key)
                    if isinstance(raw, str) and len(raw) <= 40:
                        try:
                            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                        except ValueError:
                            parsed = None
                        status[key] = raw if parsed is not None else None
                error_code = source.get("error_code", source.get("last_error"))
                status["error_code"] = (
                    error_code if isinstance(error_code, str) and error_code in reminder_routing.SAFE_ERROR_CODES else None
                )
                pending_count = source.get("pending_count")
                if type(pending_count) is int and pending_count >= 0:
                    status["pending_count"] = pending_count
                else:
                    pending = value.get("pending_deliveries", value.get("pending_events", {}))
                    if isinstance(pending, dict):
                        status["pending_count"] = sum(
                            1
                            for item in pending.values()
                            if isinstance(item, dict)
                            and item.get("status", "pending") == "pending"
                            and (
                                item.get("event_type") == event_type
                                or str(item.get("event_key") or "").startswith(
                                    "create" if event_type == "project_create" else "complete"
                                )
                            )
                        )
            except (OSError, UnicodeError, json.JSONDecodeError):
                return status
            return status

        daily_delivery_state_path = SETTINGS_PATH.with_name(
            "daily_stage_delivery_state.json"
        )
        if not daily_delivery_state_path.is_file():
            daily_delivery_state_path = SETTINGS_PATH.with_name("reminder_send_log.json")
        response["reminder_runtime_status"] = {
            "daily_stage": safe_runtime_status(
                daily_delivery_state_path, "daily_stage"
            ),
            "project_create": safe_runtime_status(
                SETTINGS_PATH.with_name("project_events_state.json"), "project_create"
            ),
            "project_complete": safe_runtime_status(
                SETTINGS_PATH.with_name("project_events_state.json"), "project_complete"
            ),
            "supplier_shortage": safe_runtime_status(
                SETTINGS_PATH.with_name("supplier_reminder_status.json"),
                "supplier_shortage",
            ),
        }

        try:
            remote = ipaddress.ip_address(request.remote_addr or "")
            mapped = getattr(remote, "ipv4_mapped", None)
            loopback = remote.is_loopback or bool(mapped and mapped.is_loopback)
        except ValueError:
            loopback = False

        if os.name != "nt" or not response["is_desktop"] or not loopback:
            return jsonify(response)

        expected = f'"{Path(sys.executable).resolve()}" --startup-minimized'
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_READ,
            ) as key:
                actual = str(winreg.QueryValueEx(key, "ProjectManagementSystemDesktop")[0])
        except FileNotFoundError:
            actual = ""
        except OSError:
            app.logger.exception("read startup settings failed")
            response["startup_enabled"] = None
            response["startup_error"] = "无法读取这台电脑的开机启动设置，请检查 Windows 权限后重试"
            return jsonify(response)

        response["startup_enabled"] = actual.strip().casefold() == expected.casefold()
        return jsonify(response)


def api_update_settings():
    try:
        import stage_templates as settings_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates as settings_templates
    with settings_templates.settings_write_lock:
        import ctypes
        import ctypes.wintypes
        import email.utils
        import json
        import ipaddress
        import os
        import smtplib
        import ssl
        import sys
        from datetime import datetime
        import winreg
        from email.message import EmailMessage
        try:
            import reminder_routing
        except ModuleNotFoundError:
            from src.backend_patches import reminder_routing
        try:
            import stage_workflow
        except ModuleNotFoundError:
            from src.backend_patches import stage_workflow
        try:
            import stage_templates
        except ModuleNotFoundError:
            from src.backend_patches import stage_templates

        data = request.get_json(force=True, silent=True) or {}
        if "stage_template_sync_method" in data and set(data) != {"stage_template_sync_method"}:
            return jsonify({"error": "阶段模板同步必须单独提交，不能同时修改其它设置"}), 400
        purchaser_action = str(data.get("purchaser_board_action") or "").strip()
        if purchaser_action:
            import purchaser_classification

            try:
                result, status = purchaser_classification.execute_purchaser_action(
                    DB_PATH,
                    DATA_DIR / "backups",
                    purchaser_action,
                    data,
                    bool(session.get("is_admin")),
                    str(session.get("username") or ""),
                    connect_encrypted,
                    MASTER_KEY,
                )
            except Exception:
                return jsonify({"error": "保存采购人分类失败"}), 500
            if status < 400:
                log_operation(
                    f"purchaser_{purchaser_action}",
                    "purchaser_classification",
                    data.get("id") or data.get("category_id"),
                    f"采购人分类操作：{purchaser_action}",
                )
            return jsonify(result), status

        updates = {}
        credential_path = None
        pending_credential = None
        clear_smtp_password = False
        preview_result = None
        original_settings = None
        stage_template_sync_summary = None

        if "stage_order" in data:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改阶段顺序"}), 403
            try:
                updates["stage_order"] = stage_workflow.normalize_stage_order(
                    data.get("stage_order"),
                    globals().get("STAGES", []),
                    strict=True,
                )
            except stage_workflow.StageOrderValidationError as exc:
                return jsonify({"error": str(exc)}), 400

        if "stage_templates" in data:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改阶段模板"}), 403
            current_settings = load_app_settings()
            try:
                updates["stage_templates"] = stage_templates.normalize_stage_templates(
                    data.get("stage_templates"),
                    globals().get("METHODS", stage_templates.PROCUREMENT_METHODS),
                    globals().get("STAGES", []),
                    stage_order=current_settings.get("stage_order"),
                    strict=True,
                    migrate_legacy_auto_completion=False,
                )
                updates["stage_auto_completion_policy_version"] = 1
            except stage_templates.StageTemplateValidationError as exc:
                return jsonify({"error": str(exc)}), 400

        if "stage_template_sync_method" in data:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以同步阶段模板"}), 403
            sync_method = str(data.get("stage_template_sync_method") or "").strip()
            methods = [str(method) for method in globals().get("METHODS", stage_templates.PROCUREMENT_METHODS)]
            if sync_method not in methods:
                return jsonify({"error": "采购方式不正确"}), 400
            current_settings = load_app_settings()
            normalized_templates = stage_templates.normalize_stage_templates(
                current_settings.get("stage_templates"),
                methods,
                globals().get("STAGES", []),
                stage_order=current_settings.get("stage_order"),
                migrate_legacy_auto_completion=current_settings.get(
                    "stage_auto_completion_policy_version"
                ) != 1,
            )
            try:
                with db.engine.begin() as connection:
                    stage_template_sync_summary = stage_templates.sync_v5_stage_template(
                        connection,
                        text,
                        sync_method,
                        normalized_templates[sync_method],
                    )
            except Exception:
                app.logger.exception("stage template sync failed")
                return jsonify({"error": "同步现有项目失败"}), 500

        reminder_fields = {
            "reminder_enabled",
            "reminder_time",
            "reminder_subject",
            "reminder_advance_days",
            "reminder_weekdays",
            "smtp_host",
            "smtp_port",
            "smtp_security",
            "smtp_username",
            "smtp_sender",
            "smtp_password",
            "clear_smtp_password",
            "reminder_recipients",
            "reminder_stage_keys",
            "reminder_content",
            "reminder_action",
            "event_reminder_create_enabled",
            "event_reminder_complete_enabled",
            "supplier_shortage_email_enabled",
            "reminder_recipient_groups",
            "reminder_group_id",
            "reminder_event_type",
        }
        reminder_requested = bool(reminder_fields.intersection(data))

        if "supplier_minimums" in data:
            import lot_supplier_risk
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改供应商数量规则"}), 403
            try:
                updates["supplier_minimums"] = lot_supplier_risk.normalize_minimums(
                    data.get("supplier_minimums")
                )
            except lot_supplier_risk.ValidationError as error:
                return jsonify({"error": str(error)}), 400

        def local_desktop_admin_error():
            if not session.get("is_admin"):
                return "只有管理员可以修改邮件提醒", 403
            if not app.config.get("IS_DESKTOP"):
                return "只能在桌面端本机修改邮件提醒", 403
            try:
                remote = ipaddress.ip_address(request.remote_addr or "")
                mapped = getattr(remote, "ipv4_mapped", None)
                loopback = remote.is_loopback or bool(mapped and mapped.is_loopback)
            except ValueError:
                loopback = False
            if not loopback:
                return "只能在桌面端本机修改邮件提醒", 403
            return None

        def normalize_recipients(values):
            if isinstance(values, str):
                values = values.replace(";", ",").split(",")
            if not isinstance(values, list):
                raise ValueError("收件邮箱必须是列表")
            normalized = []
            seen = set()
            for value in values:
                address = email.utils.parseaddr(str(value).strip())[1]
                if not address or "@" not in address or "." not in address.rsplit("@", 1)[1]:
                    raise ValueError(f"无效收件邮箱：{value}")
                marker = address.casefold()
                if marker not in seen:
                    seen.add(marker)
                    normalized.append(address)
            return normalized

        def normalize_smtp_hostname(value):
            return str(value or "").strip().rstrip(".").casefold()

        def dpapi_transform(raw, protect):
            hook_name = "_REMINDER_PROTECT_SECRET" if protect else "_REMINDER_UNPROTECT_SECRET"
            hook = globals().get(hook_name)
            if hook:
                return hook(raw)
            if os.name != "nt":
                raise RuntimeError("SMTP 密码加密仅支持 Windows")

            class DataBlob(ctypes.Structure):
                _fields_ = [("size", ctypes.wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_char))]

            source_buffer = ctypes.create_string_buffer(raw)
            source = DataBlob(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char)))
            target = DataBlob()
            crypt32 = ctypes.windll.crypt32
            if protect:
                success = crypt32.CryptProtectData(
                    ctypes.byref(source),
                    "ProcurementCommandCenterSMTP",
                    None,
                    None,
                    None,
                    0,
                    ctypes.byref(target),
                )
            else:
                success = crypt32.CryptUnprotectData(
                    ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target)
                )
            if not success:
                raise ctypes.WinError()
            try:
                return ctypes.string_at(target.data, target.size)
            finally:
                ctypes.windll.kernel32.LocalFree(target.data)

        def transaction_paths(path):
            return {
                "pending": path.with_suffix(path.suffix + ".tmp"),
                "credential_rollback": path.with_suffix(path.suffix + ".rollback"),
                "settings_rollback": SETTINGS_PATH.with_name(
                    SETTINGS_PATH.name + ".reminder-rollback"
                ),
                "marker": SETTINGS_PATH.with_name("reminder_settings_transaction.json"),
            }

        def recover_reminder_transaction(path):
            paths = transaction_paths(path)
            if not paths["marker"].is_file():
                return True
            settings_recovery = SETTINGS_PATH.with_name(
                SETTINGS_PATH.name + ".reminder-recovery"
            )
            credential_recovery = path.with_suffix(path.suffix + ".recovery")
            try:
                transaction = json.loads(paths["marker"].read_text(encoding="utf-8"))
                if transaction.get("version") != 1:
                    raise ValueError("unsupported reminder settings transaction")
                if paths["pending"].is_file():
                    if transaction.get("settings_existed"):
                        settings_recovery.write_bytes(
                            paths["settings_rollback"].read_bytes()
                        )
                        os.replace(settings_recovery, SETTINGS_PATH)
                    else:
                        SETTINGS_PATH.unlink(missing_ok=True)
                    if transaction.get("mode") == "clear":
                        if transaction.get("credential_existed"):
                            credential_recovery.write_bytes(
                                paths["credential_rollback"].read_bytes()
                            )
                            os.replace(credential_recovery, path)
                        else:
                            path.unlink(missing_ok=True)
                    paths["pending"].unlink(missing_ok=True)
                paths["settings_rollback"].unlink(missing_ok=True)
                paths["credential_rollback"].unlink(missing_ok=True)
                paths["marker"].unlink()
                return True
            except Exception:
                settings_recovery.unlink(missing_ok=True)
                credential_recovery.unlink(missing_ok=True)
                return False

        def stage_reminder_transaction(path, protected, mode, settings_existed, snapshot):
            paths = transaction_paths(path)
            marker_temporary = paths["marker"].with_suffix(paths["marker"].suffix + ".tmp")
            try:
                if settings_existed:
                    paths["settings_rollback"].write_bytes(snapshot)
                else:
                    paths["settings_rollback"].unlink(missing_ok=True)
                credential_existed = path.is_file()
                if mode == "clear" and credential_existed:
                    paths["credential_rollback"].write_bytes(path.read_bytes())
                else:
                    paths["credential_rollback"].unlink(missing_ok=True)
                paths["pending"].write_bytes(protected if mode == "set" else b"")
                marker_temporary.write_text(
                    json.dumps(
                        {
                            "version": 1,
                            "mode": mode,
                            "settings_existed": settings_existed,
                            "credential_existed": credential_existed,
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    )
                    + "\n",
                    encoding="utf-8",
                )
                os.replace(marker_temporary, paths["marker"])
                return paths
            except Exception:
                marker_temporary.unlink(missing_ok=True)
                paths["pending"].unlink(missing_ok=True)
                paths["settings_rollback"].unlink(missing_ok=True)
                paths["credential_rollback"].unlink(missing_ok=True)
                raise

        def commit_reminder_transaction(path, paths, mode):
            if mode == "set":
                os.replace(paths["pending"], path)
            else:
                path.unlink(missing_ok=True)
                paths["pending"].unlink()
            for artifact in (
                paths["settings_rollback"],
                paths["credential_rollback"],
                paths["marker"],
            ):
                try:
                    artifact.unlink(missing_ok=True)
                except OSError:
                    pass

        def send_test_email(settings, password):
            message = EmailMessage()
            subject_template = settings.get("reminder_subject") or "采购执行提醒：{date} 共 {count} 个节点"
            try:
                test_subject = subject_template.format(date="测试", count=0)
            except (KeyError, IndexError):
                test_subject = subject_template
            message["Subject"] = test_subject
            message["From"] = settings["smtp_sender"]
            message["To"] = ", ".join(settings["reminder_recipients"])
            message.set_content("邮件提醒配置有效。此测试邮件不包含任何项目或供应商数据。")
            factory = globals().get("_REMINDER_SMTP_FACTORY")
            if settings["smtp_security"] == "ssl":
                constructor = factory or smtplib.SMTP_SSL
                connection = constructor(
                    settings["smtp_host"],
                    settings["smtp_port"],
                    timeout=15,
                    context=ssl.create_default_context(),
                )
            else:
                constructor = factory or smtplib.SMTP
                connection = constructor(settings["smtp_host"], settings["smtp_port"], timeout=15)
            with connection as smtp:
                if settings["smtp_security"] == "starttls":
                    smtp.starttls(context=ssl.create_default_context())
                if settings.get("smtp_username"):
                    smtp.login(settings["smtp_username"], password)
                smtp.send_message(message)

        def requeue_nonexpired_failed_stage_reminders(now):
            state_path = SETTINGS_PATH.with_name("daily_stage_delivery_state.json")
            if not state_path.is_file():
                return 0
            state = json.loads(state_path.read_text(encoding="utf-8"))
            deliveries = state.get("deliveries") if isinstance(state, dict) else None
            if (
                not isinstance(state, dict)
                or state.get("version") != 1
                or not isinstance(deliveries, dict)
            ):
                raise ValueError("invalid daily stage delivery state")
            requeued = 0
            next_attempt_at = now.isoformat(timespec="seconds")
            for record in deliveries.values():
                if not isinstance(record, dict) or record.get("status") != "failed":
                    continue
                event = record.get("event")
                if not isinstance(event, dict) or event.get("event_type") != "daily_stage":
                    continue
                try:
                    planned = datetime.fromisoformat(
                        str(event.get("planned_at") or "").strip().replace("Z", "+00:00")
                    )
                except (TypeError, ValueError):
                    continue
                if planned.date() < now.date() or record.get("sent_at"):
                    continue
                record["status"] = "pending"
                record["attempts"] = 0
                record["next_attempt_at"] = next_attempt_at
                record["error_code"] = None
                requeued += 1
            if not requeued:
                return 0
            state["last_error"] = None
            state["pending_count"] = sum(
                isinstance(record, dict) and record.get("status") == "pending"
                for record in deliveries.values()
            )
            temporary = state_path.with_suffix(state_path.suffix + ".requeue.tmp")
            temporary.write_text(
                json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, state_path)
            return requeued

        def build_reminder_preview(settings):
            preview_date = datetime.now()
            preview_settings = dict(settings)
            preview_settings["smtp_password_configured"] = credential_path.is_file()
            stage_names = {
                stage.get("key"): stage.get("name")
                for stage in globals().get("STAGES", [])
                if isinstance(stage, dict)
            }
            enabled_stages = set(preview_settings.get("reminder_stage_keys") or stage_names)
            content = preview_settings.get("reminder_content") or {}
            sample_items = [
                {
                    "stage_key": "registration_end",
                    "stage_name": stage_names.get("registration_end", "报名截止"),
                    "project_number": "CG-2026-001",
                    "project_name": "示例采购项目",
                    "purchaser": "示例采购人单位",
                    "planned_text": preview_date.strftime("%Y-%m-%d %H:%M"),
                    "registration_count": 5,
                },
                {
                    "stage_key": "bid_opening",
                    "stage_name": stage_names.get("bid_opening", "开标"),
                    "project_number": "CG-2026-002",
                    "project_name": "示例开标项目",
                    "purchaser": "示例采购人单位",
                    "planned_text": preview_date.strftime("%Y-%m-%d %H:%M"),
                    "registration_count": 0,
                },
            ]
            sample_items = [item for item in sample_items if item["stage_key"] in enabled_stages]
            if not sample_items:
                sample_items = [{
                    "stage_key": "registration_end",
                    "stage_name": "报名截止（示例）",
                    "project_number": "CG-2026-示例",
                    "project_name": "示例采购项目",
                    "purchaser": "示例采购人单位",
                    "planned_text": preview_date.strftime("%Y-%m-%d %H:%M"),
                    "registration_count": 3,
                }]
            count = len(sample_items)
            date_str = preview_date.date().isoformat()
            subject_template = preview_settings.get("reminder_subject") or "采购执行提醒：{date} 共 {count} 个节点"
            subject = subject_template.format(date=date_str, count=count)
            lines = ["以下流程节点即将到期，请及时跟进：", ""]
            for index, item in enumerate(sample_items, 1):
                lines.append(f"{index}. {item['stage_name']}")
                if content.get("project_number", True):
                    lines.append(f"项目编号：{item['project_number']}")
                if content.get("project_name", True):
                    lines.append(f"项目名称：{item['project_name']}")
                if content.get("purchaser", True):
                    lines.append(f"采购人：{item['purchaser']}")
                if item["stage_key"] == "bid_opening":
                    lines.append(f"开标时间：{item['planned_text']}")
                elif content.get("planned_at", True):
                    lines.append(f"计划时间：{item['planned_text']}")
                if item["stage_key"] == "registration_end" and content.get("registration_count", True):
                    lines.append(f"{item['registration_count']} 家供应商已报名")
                lines.append("")
            body = "\n".join(lines)
            return {
                "subject": subject,
                "body": body,
                "recipient_count": len(preview_settings.get("reminder_recipients") or []),
                "sender": preview_settings.get("smtp_sender") or "(未配置)",
            }

        def sample_group_event(event_type):
            preview_at = datetime.now().strftime("%Y-%m-%d %H:%M")
            return {
                "event_type": event_type,
                "event_key": f"preview:{event_type}",
                "project_number": "CG-2026-001",
                "project_name": "示例采购项目",
                "purchaser": "示例采购人单位",
                "method": "公开招标",
                "year": 2026,
                "stage_name": "报名截止",
                "planned_at": preview_at,
                "registration_count": 5,
                "event_at": preview_at,
                "progress": 100 if event_type == "project_complete" else 20,
                "lot_identity": "包1 示例采购包",
                "supplier_count": 2,
                "supplier_minimum": 3,
                "supplier_missing": 1,
                "registration_deadline": preview_at,
            }

        def selected_group_delivery(settings, group_id, requested_event_type=None):
            groups = reminder_routing.normalize_recipient_groups(settings)
            selected = next((group for group in groups if group["id"] == group_id), None)
            if selected is None or not selected["enabled"]:
                raise ValueError("收件组不存在或未启用")
            event_type = str(requested_event_type or "").strip()
            if not event_type:
                event_type = selected["event_types"][0]
            if event_type not in selected["event_types"]:
                raise ValueError("该收件组未启用所选提醒类型")
            event = sample_group_event(event_type)
            deliveries = reminder_routing.route_reminder_event(event, groups)
            selected_recipients = set(selected["recipients"])
            deliveries = [
                delivery
                for delivery in deliveries
                if delivery["recipient"] in selected_recipients
            ]
            if not deliveries:
                raise ValueError("收件组没有可投递邮箱")
            return event, deliveries

        def build_group_preview(settings, group_id, requested_event_type=None):
            event, deliveries = selected_group_delivery(
                settings, group_id, requested_event_type
            )
            message = reminder_routing.render_recipient_message(
                event, deliveries[0], str(settings.get("smtp_sender") or "preview@example.invalid")
            )
            return {
                "subject": str(message["Subject"]),
                "body": message.get_body(preferencelist=("plain",)).get_content(),
                "html": message.get_body(preferencelist=("html",)).get_content(),
                "recipient_count": len(deliveries),
                "recipients": [delivery["recipient"] for delivery in deliveries],
                "event_type": event["event_type"],
            }

        def claim_test_send(group_id):
            state_path = SETTINGS_PATH.with_name("reminder_test_send_state.json")
            now_value = datetime.now()
            if state_path.is_file():
                try:
                    state = json.loads(state_path.read_text(encoding="utf-8"))
                    last_sent = datetime.fromisoformat(str(state.get("last_sent_at") or ""))
                    if (now_value - last_sent).total_seconds() < 60:
                        return False
                except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
                    raise ValueError("测试邮件频率状态无法读取")
            temporary = state_path.with_suffix(state_path.suffix + ".tmp")
            temporary.write_text(
                json.dumps(
                    {"last_sent_at": now_value.isoformat(timespec="seconds"), "group_id": group_id},
                    ensure_ascii=False,
                    sort_keys=True,
                ) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, state_path)
            return True

        if reminder_requested:
            error = local_desktop_admin_error()
            if error:
                message, status = error
                return jsonify({"error": message}), status

        startup_enabled = None
        if "startup_enabled" in data:
            startup_enabled = data.get("startup_enabled")
            if not isinstance(startup_enabled, bool):
                return jsonify({"error": "开机启动状态必须是布尔值"}), 400
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改开机启动设置"}), 403
            if os.name != "nt":
                return jsonify({"error": "开机自动启动仅支持 Windows"}), 400

            try:
                remote = ipaddress.ip_address(request.remote_addr or "")
                mapped = getattr(remote, "ipv4_mapped", None)
                loopback = remote.is_loopback or bool(mapped and mapped.is_loopback)
            except ValueError:
                loopback = False
            if not app.config.get("IS_DESKTOP") or not loopback:
                return jsonify({"error": "只能在桌面端本机修改开机启动设置"}), 403

        credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")
        if not recover_reminder_transaction(credential_path):
            return jsonify({"error": "邮件提醒设置事务恢复失败，自动发送已停止"}), 500

        if reminder_requested:
            known_stage_keys = {
                "project_setup", "procurement_request", "agency_agreement", "document_draft",
                "doc_review", "announcement", "registration_end", "bid_opening", "evaluation",
                "result_notice", "winning_notice", "contract", "acceptance", "archive",
            }
            known_content = {
                field
                for fields in reminder_routing.FIELD_ALLOWLISTS.values()
                for field in fields
            }
            current = load_app_settings()
            original_settings = dict(current)
            candidate = dict(current)
            try:
                if "reminder_enabled" in data:
                    if not isinstance(data["reminder_enabled"], bool):
                        raise ValueError("邮件提醒开关必须是布尔值")
                    candidate["reminder_enabled"] = data["reminder_enabled"]
                if "reminder_time" in data:
                    value = str(data["reminder_time"] or "")
                    pieces = value.split(":")
                    if len(pieces) != 2 or not all(piece.isdigit() for piece in pieces):
                        raise ValueError("提醒时间必须使用 HH:MM")
                    hour, minute = (int(piece) for piece in pieces)
                    if not (0 <= hour <= 23 and 0 <= minute <= 59):
                        raise ValueError("提醒时间必须使用 HH:MM")
                    candidate["reminder_time"] = f"{hour:02d}:{minute:02d}"
                if "reminder_subject" in data:
                    subject = str(data["reminder_subject"] or "").strip()
                    if not subject:
                        raise ValueError("邮件主题不能为空")
                    if len(subject) > 120:
                        raise ValueError("邮件主题不能超过 120 个字符")
                    # 仅允许 {date}/{count} 两个占位符，杜绝 format 属性链访问
                    import re as _re
                    for _token in _re.findall(r"\{[^{}]*\}", subject):
                        if _token not in ("{date}", "{count}"):
                            raise ValueError("邮件主题仅支持 {date} 和 {count} 占位符")
                    candidate["reminder_subject"] = subject
                if "reminder_advance_days" in data:
                    advance = int(data["reminder_advance_days"])
                    if not 0 <= advance <= 30:
                        raise ValueError("提前提醒天数必须在 0 到 30 之间")
                    candidate["reminder_advance_days"] = advance
                if "reminder_weekdays" in data:
                    weekdays = data["reminder_weekdays"]
                    if not isinstance(weekdays, list) or not weekdays:
                        raise ValueError("提醒星期不能为空")
                    normalized_weekdays = sorted(set(int(d) for d in weekdays))
                    if not all(0 <= d <= 6 for d in normalized_weekdays):
                        raise ValueError("提醒星期必须在 0-6 之间（0=周一）")
                    candidate["reminder_weekdays"] = normalized_weekdays
                for key in ("smtp_host", "smtp_username", "smtp_sender"):
                    if key in data:
                        candidate[key] = str(data[key] or "").strip()
                if "smtp_port" in data:
                    port = int(data["smtp_port"])
                    if not 1 <= port <= 65535:
                        raise ValueError("SMTP 端口必须在 1 到 65535 之间")
                    candidate["smtp_port"] = port
                if "smtp_security" in data:
                    security = str(data["smtp_security"] or "").lower()
                    if security not in {"ssl", "starttls"}:
                        raise ValueError("SMTP 加密方式只能是 SSL 或 STARTTLS")
                    candidate["smtp_security"] = security
                if "reminder_recipients" in data:
                    candidate["reminder_recipients"] = normalize_recipients(data["reminder_recipients"])
                if "reminder_stage_keys" in data:
                    stages = list(dict.fromkeys(str(value) for value in data["reminder_stage_keys"]))
                    if not stages or not set(stages) <= known_stage_keys:
                        raise ValueError("提醒节点包含未知阶段或为空")
                    candidate["reminder_stage_keys"] = stages
                if "reminder_content" in data:
                    content = data["reminder_content"]
                    if not isinstance(content, dict) or not set(content) <= known_content:
                        raise ValueError("邮件内容选项无效")
                    if any(not isinstance(value, bool) for value in content.values()):
                        raise ValueError("邮件内容选项必须是布尔值")
                    candidate["reminder_content"] = {key: bool(content.get(key, False)) for key in known_content}
                if "event_reminder_create_enabled" in data:
                    if not isinstance(data["event_reminder_create_enabled"], bool):
                        raise ValueError("新建项目提醒开关必须是布尔值")
                    candidate["event_reminder_create_enabled"] = data[
                        "event_reminder_create_enabled"
                    ]
                if "event_reminder_complete_enabled" in data:
                    if not isinstance(data["event_reminder_complete_enabled"], bool):
                        raise ValueError("项目完成提醒开关必须是布尔值")
                    candidate["event_reminder_complete_enabled"] = data[
                        "event_reminder_complete_enabled"
                    ]
                if "supplier_shortage_email_enabled" in data:
                    if not isinstance(data["supplier_shortage_email_enabled"], bool):
                        raise ValueError("供应商不足提醒开关必须是布尔值")
                    candidate["supplier_shortage_email_enabled"] = data[
                        "supplier_shortage_email_enabled"
                    ]
                if "reminder_recipient_groups" in data:
                    groups = reminder_routing.validate_recipient_groups(
                        data["reminder_recipient_groups"]
                    )
                    candidate["reminder_recipient_groups"] = groups
                    recipients = []
                    recipient_seen = set()
                    selected_types = set()
                    selected_fields = set()
                    for group in groups:
                        if not group["enabled"]:
                            continue
                        selected_types.update(group["event_types"])
                        selected_fields.update(
                            key
                            for key, enabled in group["content_fields"].items()
                            if enabled
                        )
                        for recipient in group["recipients"]:
                            if recipient not in recipient_seen:
                                recipient_seen.add(recipient)
                                recipients.append(recipient)
                    candidate["reminder_recipients"] = recipients
                    candidate["reminder_content"] = {
                        key: key in selected_fields for key in sorted(known_content)
                    }
                    candidate["reminder_enabled"] = bool(
                        {"daily_stage", "supplier_shortage"}.intersection(selected_types)
                    )
                    candidate["event_reminder_create_enabled"] = (
                        "project_create" in selected_types
                    )
                    candidate["event_reminder_complete_enabled"] = (
                        "project_complete" in selected_types
                    )
                    candidate["supplier_shortage_email_enabled"] = (
                        "supplier_shortage" in selected_types
                    )
                if (
                    candidate.get("reminder_enabled")
                    or candidate.get("event_reminder_create_enabled")
                    or candidate.get("event_reminder_complete_enabled")
                    or data.get("reminder_action") == "send_test"
                ):
                    if not candidate.get("smtp_host"):
                        raise ValueError("请填写 SMTP 服务器")
                    if not candidate.get("smtp_sender"):
                        raise ValueError("请填写发件邮箱")
                    if normalize_smtp_hostname(candidate.get("smtp_host")) in {
                        "smtp-mail.outlook.com", "smtp.office365.com"
                    }:
                        raise ValueError(
                            "Outlook/Hotmail 当前要求 OAuth2 现代身份验证，"
                            "不能使用 SMTP 密码测试或启用自动提醒"
                        )
                    candidate["reminder_recipients"] = normalize_recipients(candidate.get("reminder_recipients", []))
                    if not candidate["reminder_recipients"]:
                        raise ValueError("请至少填写一个收件邮箱")
            except (TypeError, ValueError) as exc:
                return jsonify({"error": str(exc)}), 400

            password = str(data.get("smtp_password") or "")
            clear_smtp_password = data.get("clear_smtp_password") is True
            if password and not clear_smtp_password:
                try:
                    pending_credential = dpapi_transform(
                        password.encode("utf-8"), True
                    )
                except Exception:
                    app.logger.exception("dpapi protect smtp password failed")
                    return jsonify({"error": "无法安全保存 SMTP 密码"}), 500

            for key in (
                "reminder_enabled", "reminder_time", "reminder_subject",
                "reminder_advance_days", "reminder_weekdays",
                "smtp_host", "smtp_port", "smtp_security",
                "smtp_username", "smtp_sender", "reminder_recipients", "reminder_stage_keys",
                "reminder_content",
                "event_reminder_create_enabled", "event_reminder_complete_enabled",
                "supplier_shortage_email_enabled", "reminder_recipient_groups",
            ):
                if key in candidate:
                    updates[key] = candidate[key]

            if data.get("reminder_action") == "preview":
                preview_result = build_reminder_preview(candidate)

            if data.get("reminder_action") == "preview_group":
                try:
                    preview_result = build_group_preview(
                        candidate,
                        str(data.get("reminder_group_id") or ""),
                        data.get("reminder_event_type"),
                    )
                except (ValueError, reminder_routing.RecipientGroupValidationError) as exc:
                    return jsonify({"error": str(exc)}), 400

            if data.get("reminder_action") == "send_test":
                if not password and not credential_path.is_file():
                    return jsonify({"error": "请先配置 SMTP 密码"}), 400
                try:
                    secret = password or dpapi_transform(
                        credential_path.read_bytes(), False
                    ).decode("utf-8")
                    send_test_email(candidate, secret)
                except smtplib.SMTPAuthenticationError:
                    return jsonify({
                        "error": "SMTP 身份验证失败：请检查登录账号和邮箱授权码；不要填写网页登录密码"
                    }), 502
                except ssl.SSLError:
                    return jsonify({
                        "error": "SMTP TLS 加密协商失败：请检查端口与加密方式是否匹配"
                    }), 502
                except (TimeoutError, OSError):
                    return jsonify({
                        "error": "无法连接 SMTP 服务器：请检查服务器地址、端口和网络状态"
                    }), 502
                except smtplib.SMTPException:
                    return jsonify({
                        "error": "SMTP 服务器拒绝发送：请检查发件邮箱、收件邮箱和服务商限制"
                    }), 502
                except Exception:
                    return jsonify({
                        "error": "测试邮件发送失败：请检查邮件配置后重试"
                    }), 502

            if data.get("reminder_action") == "send_group_test":
                group_id = str(data.get("reminder_group_id") or "")
                if not password and not credential_path.is_file():
                    return jsonify({"error": "请先配置 SMTP 密码"}), 400
                try:
                    event, deliveries = selected_group_delivery(
                        candidate, group_id, data.get("reminder_event_type")
                    )
                    if not claim_test_send(group_id):
                        return jsonify({
                            "error": "操作过于频繁，请 60 秒后重试",
                            "error_code": "TEST_EMAIL_RATE_LIMITED",
                        }), 429
                    messages = [
                        (
                            f"test:{index}",
                            reminder_routing.render_recipient_message(
                                event, delivery, str(candidate.get("smtp_sender") or "")
                            ),
                        )
                        for index, delivery in enumerate(deliveries)
                    ]
                    secret = password or dpapi_transform(
                        credential_path.read_bytes(), False
                    ).decode("utf-8")
                    results = reminder_routing.send_delivery_batch(
                        messages,
                        {
                            "host": candidate.get("smtp_host"),
                            "port": candidate.get("smtp_port"),
                            "security": candidate.get("smtp_security"),
                            "username": candidate.get("smtp_username"),
                        },
                        secret,
                        smtp_factory=globals().get("_REMINDER_SMTP_FACTORY"),
                    )
                    failure = next(
                        (result for result in results if result["status"] != "sent"),
                        None,
                    )
                    if failure:
                        messages_by_code = {
                            "SMTP_AUTH_FAILED": "SMTP 身份验证失败：请检查登录账号和邮箱授权码",
                            "SMTP_TLS_FAILED": "SMTP TLS 加密协商失败：请检查端口与加密方式",
                            "SMTP_CONNECTION_FAILED": "无法连接 SMTP 服务器：请检查地址、端口和网络",
                            "SMTP_SEND_FAILED": "SMTP 服务器拒绝发送：请检查邮箱和服务商限制",
                        }
                        return jsonify({
                            "error": messages_by_code[failure["error_code"]],
                            "error_code": failure["error_code"],
                        }), 502
                except (ValueError, reminder_routing.RecipientGroupValidationError) as exc:
                    return jsonify({"error": str(exc)}), 400
                except Exception:
                    return jsonify({
                        "error": "测试邮件发送失败：请检查邮件配置后重试",
                        "error_code": "SMTP_SEND_FAILED",
                    }), 502

        if "export_folder" in data or "login_subtitle" in data:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改系统设置"}), 403

        if "export_folder" in data:
            raw = str(data.get("export_folder") or "").strip().strip('"')
            if not raw:
                return jsonify({"error": "保存位置不能为空"}), 400
            folder = Path(raw).expanduser()
            try:
                folder.mkdir(parents=True, exist_ok=True)
            except Exception as exc:
                app.logger.exception("create export folder failed")
                return jsonify({"error": "无法创建保存目录，请检查路径权限"}), 400
            updates["export_folder"] = str(folder)

        if "login_subtitle" in data:
            subtitle = str(data.get("login_subtitle") or "").strip()
            if not subtitle:
                return jsonify({"error": "登录页副标题不能为空"}), 400
            if len(subtitle) > 60:
                return jsonify({"error": "登录页副标题不能超过 60 个字符"}), 400
            updates["login_subtitle"] = subtitle

        if startup_enabled is not None:
            expected = f'"{Path(sys.executable).resolve()}" --startup-minimized'
            run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
            value_name = "ProjectManagementSystemDesktop"
            try:
                if startup_enabled:
                    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, run_key) as key:
                        winreg.SetValueEx(key, value_name, 0, winreg.REG_SZ, expected)
                else:
                    try:
                        with winreg.OpenKey(
                            winreg.HKEY_CURRENT_USER,
                            run_key,
                            0,
                            winreg.KEY_SET_VALUE,
                        ) as key:
                            winreg.DeleteValue(key, value_name)
                    except FileNotFoundError:
                        pass
            except OSError:
                app.logger.exception("save startup settings failed")
                return jsonify({"error": "保存开机启动设置失败"}), 500

        credential_change = credential_path is not None and (
            pending_credential is not None or clear_smtp_password
        )
        settings_existed = False
        settings_snapshot = None
        transaction = None
        transaction_mode = None
        if credential_change:
            try:
                settings_existed = SETTINGS_PATH.is_file()
                if settings_existed:
                    settings_snapshot = SETTINGS_PATH.read_bytes()
                transaction_mode = "set" if pending_credential is not None else "clear"
                transaction = stage_reminder_transaction(
                    credential_path,
                    pending_credential,
                    transaction_mode,
                    settings_existed,
                    settings_snapshot,
                )
            except Exception:
                return jsonify({"error": "无法安全保存 SMTP 密码"}), 500

        try:
            settings = save_app_settings(updates)
        except Exception as settings_error:
            if transaction is not None:
                try:
                    if original_settings is not None:
                        save_app_settings(original_settings)
                except Exception:
                    pass
                recover_reminder_transaction(credential_path)
            return jsonify({"error": str(settings_error) if isinstance(settings_error, ValueError) else "保存系统设置失败"}), 500
        if transaction is not None:
            try:
                commit_reminder_transaction(
                    credential_path, transaction, transaction_mode
                )
            except Exception:
                try:
                    if original_settings is not None:
                        save_app_settings(original_settings)
                except Exception:
                    pass
                recover_reminder_transaction(credential_path)
                return jsonify({"error": "无法安全保存 SMTP 密码"}), 500
        requeued_failed_reminders = 0
        if data.get("reminder_action") == "send_test":
            try:
                requeued_failed_reminders = requeue_nonexpired_failed_stage_reminders(
                    datetime.now()
                )
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
                app.logger.exception("requeue failed stage reminders failed")
        log_operation("update_settings", "system", None, "更新系统设置")
        response = {
            "message": "邮件提醒设置已保存" if reminder_requested else "设置已保存",
            "settings": settings,
            "export_folder": settings.get("export_folder"),
        }
        response["settings"]["stage_templates"] = stage_templates.normalize_stage_templates(
            settings.get("stage_templates"),
            globals().get("METHODS", stage_templates.PROCUREMENT_METHODS),
            globals().get("STAGES", []),
            stage_order=settings.get("stage_order"),
            migrate_legacy_auto_completion=settings.get(
                "stage_auto_completion_policy_version"
            ) != 1,
        )
        response["settings"]["stage_module_catalog"] = stage_templates.module_catalog_payload()
        if startup_enabled is not None:
            response["startup_enabled"] = startup_enabled
            response["message"] = "已开启开机自动启动" if startup_enabled else "已关闭开机自动启动"
        if data.get("reminder_action") in {"send_test", "send_group_test"}:
            response["message"] = "测试邮件已发送"
        if data.get("reminder_action") == "send_test":
            response["requeued_failed_reminders"] = requeued_failed_reminders
        if preview_result is not None:
            response["message"] = "邮件预览已生成"
            response["preview"] = preview_result
        if stage_template_sync_summary is not None:
            response["message"] = "阶段模板已同步到现有项目"
            skipped = stage_template_sync_summary.get('projects_skipped_legacy', 0)
            if skipped:
                response["message"] = f"已同步 {stage_template_sync_summary['projects_updated']} 个项目，{skipped} 个旧竞价项目保持原样"
            response["sync_summary"] = stage_template_sync_summary
        return jsonify(response)


def run_project_event_reminders_if_due(now=None):
    import ctypes
    import ctypes.wintypes
    import json
    import os
    import smtplib
    import ssl
    import time
    import hashlib
    from datetime import timedelta
    from email.message import EmailMessage
    try:
        import reminder_routing
    except ModuleNotFoundError:
        from src.backend_patches import reminder_routing

    now = now or datetime.now()
    settings = load_app_settings()
    create_enabled = bool(settings.get("event_reminder_create_enabled"))
    complete_enabled = bool(settings.get("event_reminder_complete_enabled"))
    if not create_enabled and not complete_enabled:
        return None

    host = str(settings.get("smtp_host") or "").strip()
    sender = str(settings.get("smtp_sender") or "").strip()
    recipients = sorted(
        {
            str(value).strip()
            for value in settings.get("reminder_recipients", [])
            if str(value).strip()
        },
        key=str.casefold,
    )
    credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")
    state_path = SETTINGS_PATH.with_name("project_events_state.json")
    if not host or not sender or not recipients or not credential_path.is_file():
        return None

    raw_state = None
    if state_path.is_file():
        try:
            raw_state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
    use_v3 = (
        "reminder_recipient_groups" in settings
        or isinstance(raw_state, dict)
        and ("version" not in raw_state or raw_state.get("version") == 3)
    )

    if use_v3:
        def v3_empty_state():
            return {
                "version": 3,
                "initialized": False,
                "known_project_ids": [],
                "completed_project_ids": [],
                "sent_events": {},
                "pending_deliveries": {},
                "last_check_at": None,
                "last_success_at": None,
                "last_error": None,
                "recovered_stale_at": None,
            }

        def v3_parse_timestamp(value, allow_none=False):
            if value is None and allow_none:
                return None
            if not isinstance(value, str) or not value:
                raise ValueError("invalid project events state")
            parsed = datetime.fromisoformat(value)
            if parsed.microsecond:
                raise ValueError("invalid project events state")
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone().replace(tzinfo=None)
            return parsed

        def v3_valid_ids(values, integer_ids=False):
            if not isinstance(values, list):
                return False
            normalized = []
            for value in values:
                if integer_ids:
                    if type(value) is int and value > 0:
                        text = str(value)
                    elif (
                        isinstance(value, str)
                        and value.isascii()
                        and value.isdigit()
                        and not value.startswith("0")
                    ):
                        text = value
                    else:
                        return False
                else:
                    if (
                        not isinstance(value, str)
                        or not value.isascii()
                        or not value.isdigit()
                        or value.startswith("0")
                    ):
                        return False
                    text = value
                normalized.append(text)
            return len(normalized) == len(set(normalized))

        def v3_load_state():
            if raw_state is None:
                return v3_empty_state(), "new"
            if not isinstance(raw_state, dict):
                raise ValueError("invalid project events state")
            v0_keys = {
                "initialized",
                "known_project_ids",
                "completed_project_ids",
                "sent_events",
                "last_check_at",
                "last_success_at",
                "last_error",
            }
            if "version" not in raw_state:
                if set(raw_state) != v0_keys:
                    raise ValueError("invalid project events state")
                if type(raw_state["initialized"]) is not bool:
                    raise ValueError("invalid project events state")
                if not v3_valid_ids(raw_state["known_project_ids"], integer_ids=True):
                    raise ValueError("invalid project events state")
                if not v3_valid_ids(raw_state["completed_project_ids"], integer_ids=True):
                    raise ValueError("invalid project events state")
                known = [str(value) for value in raw_state["known_project_ids"]]
                completed = [str(value) for value in raw_state["completed_project_ids"]]
                if not set(completed) <= set(known):
                    raise ValueError("invalid project events state")
                old_sent = raw_state["sent_events"]
                def valid_v0_event_key(key):
                    return isinstance(key, str) and (
                        key.startswith("project_create:")
                        or key.startswith("project_complete:")
                        or key.startswith("create|")
                        or key.startswith("complete|")
                    )

                if isinstance(old_sent, list):
                    if (
                        any(not valid_v0_event_key(key) for key in old_sent)
                        or len(old_sent) != len(set(old_sent))
                    ):
                        raise ValueError("invalid project events state")
                    migrated_sent = None
                elif isinstance(old_sent, dict):
                    if any(
                        not valid_v0_event_key(key) or not isinstance(value, str)
                        for key, value in old_sent.items()
                    ):
                        raise ValueError("invalid project events state")
                    migrated_sent = dict(old_sent)
                else:
                    raise ValueError("invalid project events state")
                last_check = v3_parse_timestamp(raw_state["last_check_at"])
                last_success = v3_parse_timestamp(
                    raw_state["last_success_at"], allow_none=True
                )
                if migrated_sent is not None and any(
                    v3_parse_timestamp(value) > last_check
                    for value in migrated_sent.values()
                ):
                    raise ValueError("invalid project events state")
                if last_success is not None and last_success > last_check:
                    raise ValueError("invalid project events state")
                if raw_state["last_error"] is not None and not isinstance(
                    raw_state["last_error"], str
                ):
                    raise ValueError("invalid project events state")
                migrated = v3_empty_state()
                migrated.update(
                    {
                        "initialized": raw_state["initialized"],
                        "known_project_ids": known,
                        "completed_project_ids": completed,
                        "sent_events": migrated_sent if migrated_sent is not None else {
                            key: raw_state["last_success_at"] or raw_state["last_check_at"]
                            for key in old_sent
                        },
                        "last_check_at": raw_state["last_check_at"],
                        "last_success_at": raw_state["last_success_at"],
                    }
                )
                return migrated, "v0"
            if raw_state.get("version") in {1, 2}:
                return v3_empty_state(), "legacy_versioned"
            expected = set(v3_empty_state())
            if raw_state.get("version") != 3 or set(raw_state) != expected:
                raise ValueError("invalid project events state")
            if type(raw_state["initialized"]) is not bool:
                raise ValueError("invalid project events state")
            if not v3_valid_ids(raw_state["known_project_ids"]):
                raise ValueError("invalid project events state")
            if not v3_valid_ids(raw_state["completed_project_ids"]):
                raise ValueError("invalid project events state")
            if not set(raw_state["completed_project_ids"]) <= set(
                raw_state["known_project_ids"]
            ):
                raise ValueError("invalid project events state")
            if not isinstance(raw_state["sent_events"], dict):
                raise ValueError("invalid project events state")
            if not isinstance(raw_state["pending_deliveries"], dict):
                raise ValueError("invalid project events state")
            last_check = v3_parse_timestamp(raw_state["last_check_at"], allow_none=True)
            last_success = v3_parse_timestamp(
                raw_state["last_success_at"], allow_none=True
            )
            recovered = v3_parse_timestamp(
                raw_state["recovered_stale_at"], allow_none=True
            )
            if raw_state["initialized"] and last_check is None:
                raise ValueError("invalid project events state")
            if last_success is not None and last_check is not None and last_success > last_check:
                raise ValueError("invalid project events state")
            if recovered is not None and last_check is not None and recovered > last_check:
                raise ValueError("invalid project events state")
            allowed_errors = set(reminder_routing.SAFE_ERROR_CODES) | {"STALE_STATE_REBASE"}
            if raw_state["last_error"] is not None and raw_state["last_error"] not in allowed_errors:
                raise ValueError("invalid project events state")
            required_delivery = {
                "event_key", "event_type", "recipient", "rules_fingerprint",
                "event", "delivery", "status", "attempts", "last_attempt_at",
                "next_attempt_at", "error_code", "created_at", "sent_at",
            }
            for delivery_key, record in raw_state["pending_deliveries"].items():
                if (
                    not isinstance(delivery_key, str)
                    or len(delivery_key) != 64
                    or not isinstance(record, dict)
                    or set(record) != required_delivery
                    or record["status"] not in {"pending", "sending", "sent", "failed"}
                    or type(record["attempts"]) is not int
                    or not 0 <= record["attempts"] <= 3
                    or record["error_code"] is not None
                    and record["error_code"] not in reminder_routing.SAFE_ERROR_CODES
                ):
                    raise ValueError("invalid project events state")
                v3_parse_timestamp(record["created_at"])
                v3_parse_timestamp(record["last_attempt_at"], allow_none=True)
                v3_parse_timestamp(record["next_attempt_at"], allow_none=True)
                v3_parse_timestamp(record["sent_at"], allow_none=True)
            return raw_state, "v3"

        def v3_save_state(value):
            temporary = state_path.with_suffix(state_path.suffix + ".tmp")
            temporary.write_text(
                json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            for attempt in range(5):
                try:
                    os.replace(temporary, state_path)
                    return
                except PermissionError:
                    if attempt == 4:
                        raise
                    time.sleep(0.02 * (attempt + 1))

        def v3_unprotect_secret(raw):
            hook = globals().get("_REMINDER_UNPROTECT_SECRET")
            if hook:
                return hook(raw)
            if os.name != "nt":
                raise RuntimeError("SMTP 密码解密仅支持 Windows")
            class DataBlob(ctypes.Structure):
                _fields_ = [
                    ("size", ctypes.wintypes.DWORD),
                    ("data", ctypes.POINTER(ctypes.c_char)),
                ]
            source_buffer = ctypes.create_string_buffer(raw)
            source = DataBlob(
                len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char))
            )
            target = DataBlob()
            success = ctypes.windll.crypt32.CryptUnprotectData(
                ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target)
            )
            if not success:
                raise ctypes.WinError()
            try:
                return ctypes.string_at(target.data, target.size)
            finally:
                ctypes.windll.kernel32.LocalFree(target.data)

        try:
            groups = reminder_routing.normalize_recipient_groups(settings)
            state, state_origin = v3_load_state()
        except (ValueError, reminder_routing.RecipientGroupValidationError):
            return {"ok": False, "job": "project_events", "error_code": "STATE_INVALID"}

        projects = Project.query.options(joinedload(Project.stages)).all()
        current_ids = set()
        current_completed = set()
        projects_by_id = {}
        for project in projects:
            project_id = str(getattr(project, "id", ""))
            if (
                not project_id.isascii()
                or not project_id.isdigit()
                or project_id.startswith("0")
                or project_id in projects_by_id
            ):
                return {"ok": False, "job": "project_events", "error_code": "STATE_INVALID"}
            current_ids.add(project_id)
            projects_by_id[project_id] = project
            try:
                completed = (
                    not bool(getattr(project, "is_terminated", False))
                    and float(getattr(project, "progress", 0) or 0) >= 100
                )
            except (TypeError, ValueError):
                completed = False
            if completed:
                current_completed.add(project_id)

        checked_at = now.isoformat(timespec="seconds")
        previous_check = v3_parse_timestamp(state["last_check_at"], allow_none=True)
        if state_origin in {"new", "legacy_versioned"}:
            state = v3_empty_state()
            state.update(
                {
                    "initialized": True,
                    "known_project_ids": sorted(current_ids),
                    "completed_project_ids": sorted(current_completed),
                    "last_check_at": checked_at,
                    "last_success_at": checked_at,
                }
            )
            try:
                v3_save_state(state)
            except (OSError, UnicodeError):
                return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
            return {"ok": True, "job": "project_events", "error_code": None, "pending_count": 0, "checked_at": checked_at}

        if state_origin == "v0":
            stale = previous_check is not None and now - previous_check > timedelta(hours=24)
            if stale:
                state["known_project_ids"] = sorted(current_ids)
                state["completed_project_ids"] = sorted(current_completed)
                state["last_error"] = "STALE_STATE_REBASE"
                state["recovered_stale_at"] = checked_at
            state["last_check_at"] = checked_at
            state["last_success_at"] = checked_at
            try:
                v3_save_state(state)
            except (OSError, UnicodeError):
                return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
            return {
                "ok": True,
                "job": "project_events",
                "code": "STALE_STATE_REBASE" if stale else "STATE_MIGRATED",
                "error_code": state["last_error"],
                "pending_count": 0,
                "checked_at": checked_at,
            }

        if previous_check is not None and now - previous_check > timedelta(hours=24):
            state["known_project_ids"] = sorted(current_ids)
            state["completed_project_ids"] = sorted(current_completed)
            state["last_check_at"] = checked_at
            state["last_success_at"] = checked_at
            state["last_error"] = "STALE_STATE_REBASE"
            state["recovered_stale_at"] = checked_at
            state["pending_deliveries"] = {}
            try:
                v3_save_state(state)
            except (OSError, UnicodeError):
                return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
            return {"ok": True, "job": "project_events", "code": "STALE_STATE_REBASE", "error_code": "STALE_STATE_REBASE", "pending_count": 0, "checked_at": checked_at}

        for record in state["pending_deliveries"].values():
            if record["status"] == "sending":
                record["status"] = "failed"
                record["attempts"] = 3
                record["error_code"] = "SMTP_SEND_FAILED"

        def project_event(event_key, event_type, project):
            return {
                "event_key": event_key,
                "event_type": event_type,
                "project_number": getattr(project, "number", "") or "",
                "project_name": getattr(project, "name", "") or "",
                "purchaser": getattr(project, "purchaser", "") or "",
                "method": getattr(project, "method", "") or "",
                "year": getattr(project, "year", "") or "",
                "event_at": checked_at,
                "progress": getattr(project, "progress", 0) or 0,
            }

        known_ids = set(state["known_project_ids"])
        completed_ids = set(state["completed_project_ids"])
        new_events = []
        if create_enabled:
            for project_id in sorted(current_ids - known_ids):
                key = f"create|{project_id}"
                if key not in state["sent_events"]:
                    new_events.append(project_event(key, "project_create", projects_by_id[project_id]))
        if complete_enabled:
            for project_id in sorted(current_completed - completed_ids):
                key = f"complete|{project_id}"
                if key not in state["sent_events"]:
                    new_events.append(project_event(key, "project_complete", projects_by_id[project_id]))

        for event in new_events:
            for delivery in reminder_routing.route_reminder_event(event, groups):
                delivery_key = hashlib.sha256(
                    (
                        event["event_key"]
                        + "\0"
                        + delivery["recipient"]
                        + "\0"
                        + delivery["rules_fingerprint"]
                    ).encode("utf-8")
                ).hexdigest()
                state["pending_deliveries"].setdefault(
                    delivery_key,
                    {
                        "event_key": event["event_key"],
                        "event_type": event["event_type"],
                        "recipient": delivery["recipient"],
                        "rules_fingerprint": delivery["rules_fingerprint"],
                        "event": event,
                        "delivery": delivery,
                        "status": "pending",
                        "attempts": 0,
                        "last_attempt_at": None,
                        "next_attempt_at": checked_at,
                        "error_code": None,
                        "created_at": checked_at,
                        "sent_at": None,
                    },
                )

        state["known_project_ids"] = sorted(current_ids)
        state["completed_project_ids"] = sorted(current_completed)
        state["last_check_at"] = checked_at
        try:
            v3_save_state(state)
        except (OSError, UnicodeError):
            return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}

        due = []
        for delivery_key, record in state["pending_deliveries"].items():
            next_attempt = v3_parse_timestamp(record["next_attempt_at"], allow_none=True)
            if (
                record["status"] == "pending"
                and record["attempts"] < 3
                and (next_attempt is None or next_attempt <= now)
            ):
                record["status"] = "sending"
                record["last_attempt_at"] = checked_at
                due.append((delivery_key, record))
        if not due:
            pending_count = sum(
                record["status"] == "pending"
                for record in state["pending_deliveries"].values()
            )
            try:
                v3_save_state(state)
            except (OSError, UnicodeError):
                return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
            return {"ok": True, "job": "project_events", "error_code": state["last_error"], "pending_count": pending_count, "checked_at": checked_at}

        try:
            v3_save_state(state)
        except (OSError, UnicodeError):
            return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
        try:
            secret = v3_unprotect_secret(credential_path.read_bytes()).decode("utf-8")
            messages = [
                (
                    delivery_key,
                    reminder_routing.render_recipient_message(
                        record["event"], record["delivery"], sender
                    ),
                )
                for delivery_key, record in due
            ]
            results = reminder_routing.send_delivery_batch(
                messages,
                {
                    "host": host,
                    "port": int(settings.get("smtp_port") or 465),
                    "security": str(settings.get("smtp_security") or "ssl"),
                    "username": str(settings.get("smtp_username") or ""),
                },
                secret,
                smtp_factory=globals().get("_REMINDER_SMTP_FACTORY"),
            )
        except Exception:
            results = [
                {
                    "delivery_key": delivery_key,
                    "recipient": record["recipient"],
                    "status": "failed",
                    "error_code": "SMTP_SEND_FAILED",
                }
                for delivery_key, record in due
            ]

        first_error = None
        for result in results:
            record = state["pending_deliveries"][result["delivery_key"]]
            record["attempts"] += 1
            if result["status"] == "sent":
                record["status"] = "sent"
                record["sent_at"] = checked_at
                record["next_attempt_at"] = None
                record["error_code"] = None
            else:
                error_code = result["error_code"]
                first_error = first_error or error_code
                record["error_code"] = error_code
                terminal = error_code == "SMTP_AUTH_FAILED" or record["attempts"] >= 3
                record["status"] = "failed" if terminal else "pending"
                record["next_attempt_at"] = (
                    None
                    if terminal
                    else (now + timedelta(minutes=15)).isoformat(timespec="seconds")
                )

        event_keys = {record["event_key"] for _, record in due}
        for event_key in event_keys:
            records = [
                record
                for record in state["pending_deliveries"].values()
                if record["event_key"] == event_key
            ]
            if records and all(record["status"] == "sent" for record in records):
                state["sent_events"][event_key] = checked_at
        state["last_error"] = first_error
        if first_error is None:
            state["last_success_at"] = checked_at
        try:
            v3_save_state(state)
        except (OSError, UnicodeError):
            return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
        pending_count = sum(
            record["status"] == "pending"
            for record in state["pending_deliveries"].values()
        )
        return {"ok": first_error is None, "job": "project_events", "error_code": first_error, "pending_count": pending_count, "checked_at": checked_at}

    def empty_state():
        return {
            "version": 2,
            "initialized": False,
            "known_project_ids": [],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {},
            "last_check_at": None,
            "last_success_at": None,
            "last_error": None,
            "recovered_stale_at": None,
        }

    def load_state():
        if not state_path.is_file():
            return empty_state(), False
        value = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("invalid project events state")
        full_keys = set(empty_state())
        legacy_keys = full_keys - {"recovered_stale_at"}
        value_keys = frozenset(value)
        if value_keys not in {frozenset(full_keys), frozenset(legacy_keys)}:
            raise ValueError("invalid project events state")
        value.setdefault("recovered_stale_at", None)

        def parse_timestamp(timestamp):
            if not isinstance(timestamp, str) or not timestamp:
                raise ValueError("invalid project events state")
            parsed = datetime.fromisoformat(timestamp)
            if (
                parsed.tzinfo is not None
                or parsed.microsecond
                or parsed.isoformat(timespec="seconds") != timestamp
            ):
                raise ValueError("invalid project events state")
            return parsed

        def valid_project_id(project_id):
            return (
                isinstance(project_id, str)
                and project_id.isascii()
                and project_id.isdigit()
                and not project_id.startswith("0")
            )

        def valid_project_ids(values):
            return (
                isinstance(values, list)
                and all(valid_project_id(item) for item in values)
                and len(values) == len(set(values))
            )

        def valid_event_key(event_key):
            if not isinstance(event_key, str):
                return False
            parts = event_key.split("|")
            return (
                len(parts) == 2
                and parts[0] in {"create", "complete"}
                and valid_project_id(parts[1])
            )

        if type(value["version"]) is not int or value["version"] not in {1, 2}:
            raise ValueError("invalid project events state")
        legacy = value["version"] == 1
        if type(value["initialized"]) is not bool:
            raise ValueError("invalid project events state")
        for key in ("known_project_ids", "completed_project_ids"):
            if not valid_project_ids(value[key]):
                raise ValueError("invalid project events state")
        if not isinstance(value["sent_events"], dict) or any(
            not valid_event_key(event_key)
            or not isinstance(sent_at, str)
            or not sent_at
            for event_key, sent_at in value["sent_events"].items()
        ):
            raise ValueError("invalid project events state")
        sent_times = {
            event_key: parse_timestamp(sent_at)
            for event_key, sent_at in value["sent_events"].items()
        }
        if not isinstance(value["pending_events"], dict):
            raise ValueError("invalid project events state")
        pending_times = {}
        legacy_pending = {}
        if legacy:
            for event_key, claim in value["pending_events"].items():
                if not valid_event_key(event_key):
                    raise ValueError("invalid project events state")
                if isinstance(claim, str):
                    status = "sending"
                    claimed_at = claim
                elif (
                    isinstance(claim, dict)
                    and set(claim) == {"status", "claimed_at"}
                    and isinstance(claim["status"], str)
                    and claim["status"] in {"claimed", "sending"}
                ):
                    status = claim["status"]
                    claimed_at = claim["claimed_at"]
                else:
                    raise ValueError("invalid project events state")
                pending_times[event_key] = parse_timestamp(claimed_at)
                legacy_pending[event_key] = (status, claimed_at)
        else:
            for event_key, claim in value["pending_events"].items():
                if (
                    not valid_event_key(event_key)
                    or not isinstance(claim, dict)
                    or set(claim) != {"status", "claimed_at"}
                    or not isinstance(claim["status"], str)
                    or claim["status"] not in {"claimed", "sending"}
                ):
                    raise ValueError("invalid project events state")
                pending_times[event_key] = parse_timestamp(claim["claimed_at"])
        if not set(value["completed_project_ids"]) <= set(value["known_project_ids"]):
            raise ValueError("invalid project events state")
        if set(value["sent_events"]) & set(value["pending_events"]):
            raise ValueError("invalid project events state")
        if value["last_error"] is not None and not isinstance(value["last_error"], str):
            raise ValueError("invalid project events state")

        last_check = (
            parse_timestamp(value["last_check_at"])
            if value["last_check_at"] is not None
            else None
        )
        last_success = (
            parse_timestamp(value["last_success_at"])
            if value["last_success_at"] is not None
            else None
        )
        recovered_stale = (
            parse_timestamp(value["recovered_stale_at"])
            if value["recovered_stale_at"] is not None
            else None
        )
        if value["initialized"]:
            if last_check is None:
                raise ValueError("invalid project events state")
        elif any(
            (
                value["known_project_ids"],
                value["completed_project_ids"],
                value["sent_events"],
                value["pending_events"],
                value["last_check_at"],
                value["last_success_at"],
                value["last_error"],
                value["recovered_stale_at"],
            )
        ):
            raise ValueError("invalid project events state")
        if last_success is not None and last_success > last_check:
            raise ValueError("invalid project events state")
        if recovered_stale is not None and recovered_stale > last_check:
            raise ValueError("invalid project events state")
        if last_check is not None and any(
            timestamp > last_check
            for timestamp in list(sent_times.values()) + list(pending_times.values())
        ):
            raise ValueError("invalid project events state")

        if legacy:
            migrated_pending = {}
            for event_key, (status, claimed_at) in legacy_pending.items():
                if status == "sending":
                    value["sent_events"].setdefault(event_key, claimed_at)
                else:
                    migrated_pending[event_key] = {
                        "status": "claimed",
                        "claimed_at": claimed_at,
                    }
            value["pending_events"] = migrated_pending
            value["version"] = 2
        return value, legacy

    def save_state(value):
        temporary = state_path.with_suffix(state_path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        for attempt in range(5):
            try:
                os.replace(temporary, state_path)
                return
            except PermissionError:
                if attempt == 4:
                    raise
                # Windows Defender/indexers can briefly retain the destination
                # after a read. Keep the atomic replace and retry for at most
                # 300 ms instead of weakening the durable-send guarantee.
                time.sleep(0.02 * (attempt + 1))

    def unprotect_secret(raw):
        hook = globals().get("_REMINDER_UNPROTECT_SECRET")
        if hook:
            return hook(raw)
        if os.name != "nt":
            raise RuntimeError("SMTP 密码解密仅支持 Windows")

        class DataBlob(ctypes.Structure):
            _fields_ = [
                ("size", ctypes.wintypes.DWORD),
                ("data", ctypes.POINTER(ctypes.c_char)),
            ]

        source_buffer = ctypes.create_string_buffer(raw)
        source = DataBlob(
            len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char))
        )
        target = DataBlob()
        success = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target)
        )
        if not success:
            raise ctypes.WinError()
        try:
            return ctypes.string_at(target.data, target.size)
        finally:
            ctypes.windll.kernel32.LocalFree(target.data)

    def build_message(event_type, project):
        message = EmailMessage()
        name = getattr(project, "name", "") or "-"
        if event_type == "create":
            message["Subject"] = f"项目新建提醒：{name}"
            headline = "新项目已创建，请及时跟进。"
            time_label = "创建时间"
        else:
            message["Subject"] = f"项目完成提醒：{name}"
            headline = "项目已完成全部流程节点。"
            time_label = "完成时间"
        message["From"] = sender
        message["To"] = ", ".join(recipients)
        message.set_content(
            "\n".join(
                [
                    headline,
                    "",
                    f"项目编号：{getattr(project, 'number', '') or '-'}",
                    f"项目名称：{name}",
                    f"采购人：{getattr(project, 'purchaser', '') or '-'}",
                    f"年度：{getattr(project, 'year', '') or '-'}",
                    f"采购方式：{getattr(project, 'method', '') or '-'}",
                    "",
                    f"{time_label}：{now.strftime('%Y-%m-%d %H:%M')}",
                ]
            )
        )
        return message

    try:
        state, migrated = load_state()
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return None

    projects = Project.query.options(joinedload(Project.stages)).all()
    current_ids = set()
    current_completed = set()
    projects_by_id = {}
    for project in projects:
        project_id = str(getattr(project, "id", ""))
        if (
            not project_id.isascii()
            or not project_id.isdigit()
            or project_id.startswith("0")
            or project_id in projects_by_id
        ):
            return None
        current_ids.add(project_id)
        projects_by_id[project_id] = project
        try:
            completed = (
                not bool(getattr(project, "is_terminated", False))
                and float(getattr(project, "progress", 0) or 0) >= 100
            )
        except (TypeError, ValueError):
            completed = False
        if completed:
            current_completed.add(project_id)

    previous_check = (
        datetime.fromisoformat(state["last_check_at"])
        if state["last_check_at"] is not None
        else None
    )
    checked_at = now.isoformat(timespec="seconds")
    if (
        state["initialized"]
        and previous_check is not None
        and now - previous_check > timedelta(hours=24)
    ):
        state["known_project_ids"] = sorted(current_ids)
        state["completed_project_ids"] = sorted(current_completed)
        state["pending_events"] = {}
        state["last_check_at"] = checked_at
        state["last_success_at"] = checked_at
        state["last_error"] = "STALE_STATE_REBASE: 已跳过停机期间的历史项目事件"
        state["recovered_stale_at"] = checked_at
        try:
            save_state(state)
        except (OSError, UnicodeError):
            return None
        return None
    if state["initialized"]:
        known_ids_for_validation = set(state["known_project_ids"])
        existing_event_ids = {
            event_key.split("|", 1)[1]
            for event_key in set(state["sent_events"]) | set(state["pending_events"])
        }
        for project_id in current_ids - known_ids_for_validation - existing_event_ids:
            created_at = getattr(projects_by_id[project_id], "created_at", None)
            if isinstance(created_at, datetime):
                created = created_at
            else:
                try:
                    created = datetime.fromisoformat(str(created_at or ""))
                except (TypeError, ValueError):
                    return None
            if created.tzinfo is not None:
                created = created.astimezone().replace(tzinfo=None)
            if created <= previous_check:
                return None

    if migrated:
        try:
            save_state(state)
        except (OSError, UnicodeError):
            return None

    if not state.get("initialized"):
        state["initialized"] = True
        state["last_check_at"] = checked_at
        state["known_project_ids"] = sorted(current_ids)
        state["completed_project_ids"] = sorted(current_completed)
        try:
            save_state(state)
        except (OSError, UnicodeError):
            pass
        return None

    # Only the persisted `sending` phase is ambiguous after a restart. A plain
    # claim proves SMTP was never called and is released for a normal retry.
    if state["pending_events"]:
        for event_key, claim in state["pending_events"].items():
            if claim["status"] == "sending":
                state["sent_events"].setdefault(event_key, claim["claimed_at"])
        state["pending_events"] = {}
        try:
            save_state(state)
        except (OSError, UnicodeError):
            return None

    state["last_check_at"] = checked_at

    known_ids = {str(value) for value in state["known_project_ids"]}
    completed_ids = {str(value) for value in state["completed_project_ids"]}
    pending = []
    if create_enabled:
        for project_id in sorted(current_ids - known_ids):
            event_key = f"create|{project_id}"
            if event_key not in state["sent_events"]:
                pending.append((event_key, "create", projects_by_id[project_id]))
    if complete_enabled:
        for project_id in sorted(current_completed - completed_ids):
            event_key = f"complete|{project_id}"
            if event_key not in state["sent_events"]:
                pending.append((event_key, "complete", projects_by_id[project_id]))

    if not pending:
        state["known_project_ids"] = sorted(current_ids)
        state["completed_project_ids"] = sorted(current_completed)
        try:
            save_state(state)
        except (OSError, UnicodeError):
            pass
        return None

    previous_known = list(state["known_project_ids"])
    previous_completed = list(state["completed_project_ids"])
    for event_key, _, _ in pending:
        state["pending_events"][event_key] = {
            "status": "claimed",
            "claimed_at": checked_at,
        }
    try:
        save_state(state)
    except (OSError, UnicodeError):
        return None

    connection_ready = False
    send_started = False
    try:
        password = unprotect_secret(credential_path.read_bytes()).decode("utf-8")
        factory = globals().get("_REMINDER_SMTP_FACTORY")
        port = int(settings.get("smtp_port") or 465)
        security = str(settings.get("smtp_security") or "ssl")
        if security == "ssl":
            constructor = factory or smtplib.SMTP_SSL
            connection = constructor(
                host, port, timeout=15, context=ssl.create_default_context()
            )
        else:
            constructor = factory or smtplib.SMTP
            connection = constructor(host, port, timeout=15)
        with connection as smtp:
            if security == "starttls":
                smtp.starttls(context=ssl.create_default_context())
            username = str(settings.get("smtp_username") or "")
            if username:
                smtp.login(username, password)
            connection_ready = True
            for event_key, event_type, project in pending:
                send_started = False
                message = build_message(event_type, project)
                message.as_bytes()
                state["pending_events"][event_key]["status"] = "sending"
                try:
                    save_state(state)
                except (OSError, UnicodeError):
                    return None
                send_started = True
                smtp.send_message(message)
                state["sent_events"][event_key] = checked_at
                state["pending_events"].pop(event_key, None)
                try:
                    save_state(state)
                except (OSError, UnicodeError):
                    # The durable claim remains. A later scan will fail closed
                    # instead of sending a message that may already be accepted.
                    return None
    except Exception as exc:
        if isinstance(exc, smtplib.SMTPAuthenticationError):
            state["last_error"] = "SMTP_AUTH_FAILED: SMTP 身份验证失败"
        elif isinstance(exc, ssl.SSLError):
            state["last_error"] = "SMTP_TLS_FAILED: SMTP TLS 协商失败"
        elif isinstance(exc, (TimeoutError, OSError)):
            state["last_error"] = "SMTP_CONNECTION_FAILED: 无法连接 SMTP 服务器"
        elif isinstance(exc, smtplib.SMTPException):
            state["last_error"] = "SMTP_SEND_FAILED: SMTP 服务器拒绝发送"
        else:
            state["last_error"] = "SMTP_SEND_FAILED: 邮件发送失败"
        state["known_project_ids"] = previous_known
        state["completed_project_ids"] = previous_completed
        confirmed_rejection = isinstance(
            exc,
            (
                smtplib.SMTPDataError,
                smtplib.SMTPRecipientsRefused,
                smtplib.SMTPSenderRefused,
                smtplib.SMTPHeloError,
                smtplib.SMTPNotSupportedError,
            ),
        )
        definitely_not_sent = (
            not connection_ready or not send_started or confirmed_rejection
        )
        if definitely_not_sent:
            for claim in state["pending_events"].values():
                if claim["status"] == "sending":
                    claim["status"] = "claimed"
        # For an ambiguous active send, retain its `sending` claim and every
        # later `claimed` event. Restart recovery suppresses only the ambiguous
        # message and retries events for which SMTP was never called.
        try:
            save_state(state)
        except (OSError, UnicodeError):
            pass
        return None

    state["known_project_ids"] = sorted(current_ids)
    state["completed_project_ids"] = sorted(current_completed)
    state["last_success_at"] = checked_at
    state["last_error"] = None
    try:
        save_state(state)
    except (OSError, UnicodeError):
        pass
    return None


def run_scheduled_backup_if_due(now=None, job="backup"):
    import ctypes
    import ctypes.wintypes
    import hashlib
    import json
    import os
    import smtplib
    import ssl
    from datetime import timedelta
    from email.message import EmailMessage
    try:
        import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow

    now = now or datetime.now()
    backup = None
    if job not in {"backup", "digest"}:
        raise ValueError(f"unknown scheduled job: {job}")
    if job == "digest":
        credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")
        pending_path = credential_path.with_suffix(credential_path.suffix + ".tmp")
        credential_rollback_path = credential_path.with_suffix(
            credential_path.suffix + ".rollback"
        )
        settings_rollback_path = SETTINGS_PATH.with_name(
            SETTINGS_PATH.name + ".reminder-rollback"
        )
        transaction_path = SETTINGS_PATH.with_name(
            "reminder_settings_transaction.json"
        )
        if transaction_path.is_file():
            settings_recovery = SETTINGS_PATH.with_name(
                SETTINGS_PATH.name + ".reminder-recovery"
            )
            credential_recovery = credential_path.with_suffix(
                credential_path.suffix + ".recovery"
            )
            try:
                transaction = json.loads(
                    transaction_path.read_text(encoding="utf-8")
                )
                if transaction.get("version") != 1:
                    raise ValueError("unsupported reminder settings transaction")
                if pending_path.is_file():
                    if transaction.get("settings_existed"):
                        settings_recovery.write_bytes(
                            settings_rollback_path.read_bytes()
                        )
                        os.replace(settings_recovery, SETTINGS_PATH)
                    else:
                        SETTINGS_PATH.unlink(missing_ok=True)
                    if transaction.get("mode") == "clear":
                        if transaction.get("credential_existed"):
                            credential_recovery.write_bytes(
                                credential_rollback_path.read_bytes()
                            )
                            os.replace(credential_recovery, credential_path)
                        else:
                            credential_path.unlink(missing_ok=True)
                    pending_path.unlink(missing_ok=True)
                settings_rollback_path.unlink(missing_ok=True)
                credential_rollback_path.unlink(missing_ok=True)
                transaction_path.unlink()
            except Exception:
                settings_recovery.unlink(missing_ok=True)
                credential_recovery.unlink(missing_ok=True)
                return backup
    settings = load_app_settings()
    ordered_stages = stage_workflow.ordered_stage_definitions(
        globals().get("STAGES", []), settings
    )
    stage_names = {
        stage.get("key"): stage.get("name")
        for stage in ordered_stages
        if isinstance(stage, dict)
    }
    stage_rank = {
        stage.get("key"): index
        for index, stage in enumerate(ordered_stages)
        if isinstance(stage, dict)
    }

    def ordered_project_stages(project):
        rows = list(getattr(project, "stages", None) or [])
        return sorted(
            rows,
            key=lambda stage: stage_rank.get(
                getattr(stage, "stage_key", None) or getattr(stage, "key", None),
                len(stage_rank),
            ),
        )
    try:
        backup_hour, backup_minute = (
            int(part)
            for part in str(settings.get("backup_time") or "13:00").split(":", 1)
        )
    except (TypeError, ValueError):
        backup_hour, backup_minute = 13, 0
    if job == "backup":
        if (
            (now.hour, now.minute) >= (backup_hour, backup_minute)
            and settings.get("last_backup_date") != now.date().isoformat()
        ):
            backup = create_full_backup()
        return backup

    import lot_supplier_risk

    if not settings.get("reminder_enabled"):
        return backup
    try:
        reminder_hour, reminder_minute = (
            int(part)
            for part in str(settings.get("reminder_time") or "09:00").split(":", 1)
        )
    except (TypeError, ValueError):
        reminder_hour, reminder_minute = 9, 0
    if (now.hour, now.minute) < (reminder_hour, reminder_minute):
        return backup

    weekdays = settings.get("reminder_weekdays")
    if weekdays and isinstance(weekdays, list) and now.weekday() not in weekdays:
        return backup

    advance_days = 0
    try:
        advance_days = int(settings.get("reminder_advance_days") or 0)
        if not 0 <= advance_days <= 30:
            advance_days = 0
    except (TypeError, ValueError):
        advance_days = 0

    state_path = SETTINGS_PATH.with_name("reminder_send_log.json")
    credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")

    def empty_state():
        return {
            "sent": {},
            "attempts": {},
            "last_check_at": None,
            "last_success_at": None,
            "last_error": None,
            "sent_today": 0,
        }

    def load_state():
        if not state_path.is_file():
            return empty_state()
        value = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("sent"), dict) or not isinstance(value.get("attempts"), dict):
            raise ValueError("invalid reminder state")
        return value

    def save_state(value):
        temporary = state_path.with_suffix(state_path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, state_path)

    def planned_value(stage):
        return (
            getattr(stage, "planned_datetime", None)
            or getattr(stage, "planned_at", None)
            or getattr(stage, "planned_date", None)
        )

    def parse_planned(value):
        if isinstance(value, datetime):
            return value
        if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
            return datetime(value.year, value.month, value.day)
        raw = str(value or "").strip().replace("Z", "+00:00")
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            try:
                return datetime.strptime(raw[:10], "%Y-%m-%d")
            except ValueError:
                return None

    def unprotect_secret(raw):
        hook = globals().get("_REMINDER_UNPROTECT_SECRET")
        if hook:
            return hook(raw)
        if os.name != "nt":
            raise RuntimeError("SMTP 密码解密仅支持 Windows")

        class DataBlob(ctypes.Structure):
            _fields_ = [("size", ctypes.wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_char))]

        source_buffer = ctypes.create_string_buffer(raw)
        source = DataBlob(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char)))
        target = DataBlob()
        success = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target)
        )
        if not success:
            raise ctypes.WinError()
        try:
            return ctypes.string_at(target.data, target.size)
        finally:
            ctypes.windll.kernel32.LocalFree(target.data)

    if "reminder_recipient_groups" in settings:
        try:
            import reminder_routing
        except ModuleNotFoundError:
            from src.backend_patches import reminder_routing

        delivery_state_path = SETTINGS_PATH.with_name(
            "daily_stage_delivery_state.json"
        )

        def empty_delivery_state():
            return {
                "version": 1,
                "deliveries": {},
                "last_check_at": None,
                "last_success_at": None,
                "last_error": None,
                "pending_count": 0,
            }

        def load_delivery_state():
            if not delivery_state_path.is_file():
                return empty_delivery_state()
            value = json.loads(delivery_state_path.read_text(encoding="utf-8"))
            if not isinstance(value, dict) or set(value) != set(empty_delivery_state()):
                raise ValueError("invalid daily stage delivery state")
            if value.get("version") != 1 or not isinstance(value.get("deliveries"), dict):
                raise ValueError("invalid daily stage delivery state")
            if value.get("last_error") is not None and value.get("last_error") not in reminder_routing.SAFE_ERROR_CODES:
                raise ValueError("invalid daily stage delivery state")
            for delivery_key, record in value["deliveries"].items():
                if (
                    not isinstance(delivery_key, str)
                    or len(delivery_key) != 64
                    or not isinstance(record, dict)
                    or record.get("status") not in {"pending", "sending", "sent", "failed"}
                    or type(record.get("attempts")) is not int
                    or not 0 <= record["attempts"] <= 3
                ):
                    raise ValueError("invalid daily stage delivery state")
            return value

        def save_delivery_state(value):
            temporary = delivery_state_path.with_suffix(
                delivery_state_path.suffix + ".tmp"
            )
            temporary.write_text(
                json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, delivery_state_path)

        try:
            groups = reminder_routing.normalize_recipient_groups(settings)
            delivery_state = load_delivery_state()
        except (ValueError, OSError, UnicodeError, json.JSONDecodeError):
            return {
                "ok": False,
                "job": "daily_stage",
                "error_code": "STATE_INVALID",
                "pending_count": 0,
                "checked_at": now.isoformat(timespec="seconds"),
            }

        projects = Project.query.options(
            joinedload(Project.stages),
            joinedload(Project.registrations),
            joinedload(Project.lots),
        ).all()
        supplier_due = []
        supplier_error = None
        supplier_enabled = any(
            group["enabled"] and "supplier_shortage" in group["event_types"]
            for group in groups
        )
        if supplier_enabled:
            try:
                lot_supplier_risk.ensure_schema(db)
                for project in projects:
                    if not getattr(project, "is_terminated", False):
                        lot_supplier_risk.queue_due_warning_events(
                            db, project, now, settings
                        )
                db.session.commit()
                for parent in lot_supplier_risk.pending_mail_events(db):
                    deadline = str(parent.get("deadline") or "")
                    try:
                        deadline_text = datetime.fromisoformat(deadline).strftime(
                            "%Y-%m-%d %H:%M"
                        )
                    except (TypeError, ValueError):
                        deadline_text = deadline
                    for index, item in enumerate(parent.get("items") or []):
                        lot_identity = (
                            "项目整体"
                            if item.get("lot_id") is None
                            else f"{item.get('lot_number') or ''} {item.get('lot_name') or '未命名包'}".strip()
                        )
                        event = {
                            "event_type": "supplier_shortage",
                            "event_key": f"supplier_shortage:{parent['id']}:{item.get('lot_id') or 'project'}:{index}",
                            "project_number": parent.get("project_number") or "",
                            "project_name": parent.get("project_name") or "",
                            "purchaser": parent.get("purchaser") or "",
                            "method": parent.get("method") or item.get("method") or "",
                            "year": parent.get("year") or "",
                            "lot_identity": lot_identity,
                            "supplier_count": item.get("registration_count"),
                            "supplier_minimum": item.get("required_count"),
                            "supplier_missing": item.get("missing_count"),
                            "registration_deadline": deadline_text,
                        }
                        deliveries = reminder_routing.route_reminder_event(event, groups)
                        lot_supplier_risk.claim_mail_deliveries(
                            db, parent, event, deliveries, now
                        )
                db.session.commit()
                supplier_due = lot_supplier_risk.pending_mail_deliveries(db, now)
            except Exception:
                db.session.rollback()
                supplier_error = "STATE_WRITE_FAILED"
                supplier_due = []
        enabled_stages = set(settings.get("reminder_stage_keys") or stage_names)
        checked_at = now.isoformat(timespec="seconds")
        existing_event_keys = {
            record.get("event_key")
            for record in delivery_state["deliveries"].values()
            if isinstance(record, dict)
        }
        events = []
        for project in projects:
            if getattr(project, "is_terminated", False):
                continue
            for stage in ordered_project_stages(project):
                stage_key = getattr(stage, "stage_key", None) or getattr(stage, "key", None)
                if stage_key not in enabled_stages:
                    continue
                if (
                    getattr(stage, "completed", False)
                    or getattr(stage, "is_completed", False)
                    or getattr(stage, "skipped", False)
                ):
                    continue
                planned = parse_planned(planned_value(stage))
                if planned is None:
                    continue
                target_date = now.date()
                if advance_days > 0:
                    deadline = target_date + timedelta(days=advance_days)
                    if not target_date <= planned.date() <= deadline:
                        continue
                elif planned.date() != target_date:
                    continue
                event_key = ":".join(
                    (
                        "daily_stage",
                        now.date().isoformat(),
                        str(getattr(project, "id", "")),
                        str(stage_key),
                        planned.isoformat(),
                    )
                )
                if event_key in existing_event_keys:
                    continue
                event = {
                    "event_type": "daily_stage",
                    "event_key": event_key,
                    "project_number": getattr(project, "number", "") or "",
                    "project_name": getattr(project, "name", "") or "",
                    "purchaser": getattr(project, "purchaser", "") or "",
                    "method": getattr(project, "method", "") or "",
                    "year": getattr(project, "year", "") or "",
                    "stage_name": getattr(stage, "name", None)
                    or stage_names.get(stage_key)
                    or str(stage_key),
                    "planned_at": planned.strftime("%Y-%m-%d %H:%M"),
                    "registration_count": len(
                        list(getattr(project, "registrations", None) or [])
                    ),
                }
                events.append(event)

        for event in events:
            for delivery in reminder_routing.route_reminder_event(event, groups):
                delivery_key = hashlib.sha256(
                    (
                        event["event_key"]
                        + "\0"
                        + delivery["recipient"]
                        + "\0"
                        + delivery["rules_fingerprint"]
                    ).encode("utf-8")
                ).hexdigest()
                delivery_state["deliveries"].setdefault(
                    delivery_key,
                    {
                        "event_key": event["event_key"],
                        "event": event,
                        "delivery": delivery,
                        "status": "pending",
                        "attempts": 0,
                        "last_attempt_at": None,
                        "next_attempt_at": checked_at,
                        "error_code": None,
                        "sent_at": None,
                    },
                )

        for record in delivery_state["deliveries"].values():
            if record["status"] == "sending":
                record["status"] = "failed"
                record["attempts"] = 3
                record["error_code"] = "SMTP_SEND_FAILED"

        due = []
        for delivery_key, record in delivery_state["deliveries"].items():
            next_attempt = record.get("next_attempt_at")
            try:
                next_at = datetime.fromisoformat(next_attempt) if next_attempt else None
            except (TypeError, ValueError):
                return {
                    "ok": False,
                    "job": "daily_stage",
                    "error_code": "STATE_INVALID",
                    "pending_count": 0,
                    "checked_at": checked_at,
                }
            if (
                record["status"] == "pending"
                and record["attempts"] < 3
                and (next_at is None or next_at <= now)
            ):
                record["status"] = "sending"
                record["last_attempt_at"] = checked_at
                due.append((delivery_key, record))

        delivery_state["last_check_at"] = checked_at
        delivery_state["pending_count"] = sum(
            record["status"] == "pending"
            for record in delivery_state["deliveries"].values()
        )
        try:
            save_delivery_state(delivery_state)
        except (OSError, UnicodeError):
            return {
                "ok": False,
                "job": "daily_stage",
                "error_code": "STATE_WRITE_FAILED",
                "pending_count": delivery_state["pending_count"],
                "checked_at": checked_at,
            }
        if not due and not supplier_due:
            return {
                "ok": supplier_error is None,
                "job": "daily_stage",
                "error_code": supplier_error or delivery_state["last_error"],
                "pending_count": delivery_state["pending_count"],
                "checked_at": checked_at,
            }

        try:
            if not credential_path.is_file():
                raise OSError("SMTP credential is missing")
            secret = unprotect_secret(credential_path.read_bytes()).decode("utf-8")
            daily_messages = [
                (
                    delivery_key,
                    reminder_routing.render_recipient_message(
                        record["event"],
                        record["delivery"],
                        str(settings.get("smtp_sender") or ""),
                    ),
                )
                for delivery_key, record in due
            ]
            supplier_messages = [
                (
                    record["delivery_key"],
                    reminder_routing.render_recipient_message(
                        record["event"],
                        record["delivery"],
                        str(settings.get("smtp_sender") or ""),
                    ),
                )
                for record in supplier_due
            ]
            messages = daily_messages + supplier_messages
            results = reminder_routing.send_delivery_batch(
                messages,
                {
                    "host": settings.get("smtp_host"),
                    "port": settings.get("smtp_port"),
                    "security": settings.get("smtp_security"),
                    "username": settings.get("smtp_username"),
                },
                secret,
                smtp_factory=globals().get("_REMINDER_SMTP_FACTORY"),
            )
        except Exception:
            results = [
                {
                    "delivery_key": delivery_key,
                    "recipient": record["delivery"]["recipient"],
                    "status": "failed",
                    "error_code": "SMTP_SEND_FAILED",
                }
                for delivery_key, record in due
            ] + [
                {
                    "delivery_key": record["delivery_key"],
                    "recipient": record["recipient"],
                    "status": "failed",
                    "error_code": "SMTP_SEND_FAILED",
                }
                for record in supplier_due
            ]

        daily_error = None
        supplier_result_error = supplier_error
        daily_keys = {delivery_key for delivery_key, _ in due}
        supplier_keys = {record["delivery_key"] for record in supplier_due}
        for result in results:
            if result["delivery_key"] not in daily_keys:
                continue
            record = delivery_state["deliveries"][result["delivery_key"]]
            record["attempts"] += 1
            if result["status"] == "sent":
                record["status"] = "sent"
                record["sent_at"] = checked_at
                record["next_attempt_at"] = None
                record["error_code"] = None
            else:
                error_code = result["error_code"]
                daily_error = daily_error or error_code
                record["error_code"] = error_code
                terminal = error_code == "SMTP_AUTH_FAILED" or record["attempts"] >= 3
                record["status"] = "failed" if terminal else "pending"
                record["next_attempt_at"] = (
                    None
                    if terminal
                    else (now + timedelta(minutes=15)).isoformat(timespec="seconds")
                )
        try:
            for result in results:
                if result["delivery_key"] in supplier_keys:
                    lot_supplier_risk.mark_mail_delivery_result(
                        db, result["delivery_key"], result, now
                    )
                    if result["status"] != "sent":
                        supplier_result_error = (
                            supplier_result_error or result["error_code"]
                        )
            if supplier_keys:
                db.session.commit()
        except Exception:
            db.session.rollback()
            supplier_result_error = supplier_result_error or "STATE_WRITE_FAILED"

        supplier_status_path = SETTINGS_PATH.with_name(
            "supplier_reminder_status.json"
        )
        supplier_status_temporary = supplier_status_path.with_suffix(
            supplier_status_path.suffix + ".tmp"
        )
        try:
            remaining_supplier = lot_supplier_risk.pending_mail_deliveries(db, now)
            supplier_status_temporary.write_text(
                json.dumps(
                    {
                        "last_check_at": checked_at,
                        "last_success_at": checked_at
                        if supplier_keys and not any(
                            result["status"] != "sent"
                            for result in results
                            if result["delivery_key"] in supplier_keys
                        )
                        else None,
                        "error_code": supplier_result_error
                        if supplier_result_error in reminder_routing.SAFE_ERROR_CODES
                        else None,
                        "pending_count": len(remaining_supplier),
                    },
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                ) + "\n",
                encoding="utf-8",
            )
            os.replace(supplier_status_temporary, supplier_status_path)
        except Exception:
            supplier_status_temporary.unlink(missing_ok=True)
        delivery_state["last_error"] = daily_error
        if daily_error is None and daily_keys:
            delivery_state["last_success_at"] = checked_at
        delivery_state["pending_count"] = sum(
            record["status"] == "pending"
            for record in delivery_state["deliveries"].values()
        )
        try:
            save_delivery_state(delivery_state)
        except (OSError, UnicodeError):
            return {
                "ok": False,
                "job": "daily_stage",
                "error_code": "STATE_WRITE_FAILED",
                "pending_count": delivery_state["pending_count"],
                "checked_at": checked_at,
            }
        return {
            "ok": daily_error is None and supplier_result_error is None,
            "job": "daily_stage",
            "error_code": daily_error or supplier_result_error,
            "pending_count": delivery_state["pending_count"],
            "checked_at": checked_at,
        }

    try:
        state = load_state()
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return backup

    enabled_stages = set(settings.get("reminder_stage_keys") or stage_names)
    recipients = sorted(
        {str(value).strip() for value in settings.get("reminder_recipients", []) if str(value).strip()},
        key=str.casefold,
    )
    projects = Project.query.options(
        joinedload(Project.stages),
        joinedload(Project.registrations),
        joinedload(Project.lots),
    ).all()
    try:
        lot_supplier_risk.ensure_schema(db)
        for project in projects:
            if not getattr(project, "is_terminated", False):
                lot_supplier_risk.queue_due_warning_events(
                    db, project, now, settings
                )
        db.session.commit()
        lot_mail = lot_supplier_risk.pending_mail_events(db)
    except Exception:
        db.session.rollback()
        lot_mail = []

    if lot_mail:
        try:
            if not credential_path.is_file():
                raise RuntimeError("SMTP password is not configured")
            lot_password = unprotect_secret(credential_path.read_bytes()).decode("utf-8")
            lot_factory = globals().get("_REMINDER_SMTP_FACTORY")
            lot_host = str(settings.get("smtp_host") or "")
            lot_port = int(settings.get("smtp_port") or 465)
            lot_security = str(settings.get("smtp_security") or "ssl")
            if lot_security == "ssl":
                lot_connection = (lot_factory or smtplib.SMTP_SSL)(
                    lot_host, lot_port, timeout=15, context=ssl.create_default_context()
                )
            else:
                lot_connection = (lot_factory or smtplib.SMTP)(lot_host, lot_port, timeout=15)
            with lot_connection as smtp:
                if lot_security == "starttls":
                    smtp.starttls(context=ssl.create_default_context())
                lot_username = str(settings.get("smtp_username") or "")
                if lot_username:
                    smtp.login(lot_username, lot_password)
                for event in lot_mail:
                    lot_message = EmailMessage()
                    lot_message["Subject"] = event["subject"]
                    lot_message["From"] = str(settings.get("smtp_sender") or "")
                    lot_message["To"] = ", ".join(event.get("recipients") or recipients)
                    lot_message.set_content(event["body"])
                    smtp.send_message(lot_message)
                    lot_supplier_risk.mark_mail_sent(db, event["id"], now)
                    db.session.commit()
        except smtplib.SMTPAuthenticationError:
            for event in lot_mail:
                lot_supplier_risk.mark_mail_failed(db, event["id"], "SMTP_AUTH_FAILED")
            db.session.commit()
        except ssl.SSLError:
            for event in lot_mail:
                lot_supplier_risk.mark_mail_failed(db, event["id"], "SMTP_TLS_FAILED")
            db.session.commit()
        except (TimeoutError, OSError):
            for event in lot_mail:
                lot_supplier_risk.mark_mail_failed(db, event["id"], "SMTP_CONNECTION_FAILED")
            db.session.commit()
        except Exception:
            for event in lot_mail:
                lot_supplier_risk.mark_mail_failed(db, event["id"], "SMTP_SEND_FAILED")
            db.session.commit()
    items = []
    for project in projects:
        if getattr(project, "is_terminated", False):
            continue
        for stage in ordered_project_stages(project):
            key = getattr(stage, "stage_key", None) or getattr(stage, "key", None)
            if key not in enabled_stages:
                continue
            if getattr(stage, "completed", False) or getattr(stage, "is_completed", False) or getattr(stage, "skipped", False):
                continue
            planned = parse_planned(planned_value(stage))
            if planned is None:
                continue
            target_date = now.date()
            if advance_days > 0:
                deadline = target_date + timedelta(days=advance_days)
                if not (target_date <= planned.date() <= deadline):
                    continue
            elif planned.date() != target_date:
                continue
            planned_text = planned.strftime("%Y-%m-%d %H:%M") if planned.time() != datetime.min.time() else planned.strftime("%Y-%m-%d")
            dedupe_key = "|".join(
                [
                    now.date().isoformat(),
                    str(getattr(project, "id", "")),
                    str(key),
                    planned.isoformat(),
                    ",".join(recipients),
                ]
            )
            if dedupe_key in state["sent"]:
                continue
            items.append(
                {
                    "dedupe_key": dedupe_key,
                    "project": project,
                    "stage_key": key,
                    "stage_name": getattr(stage, "name", None) or stage_names.get(key) or str(key),
                    "planned": planned,
                    "planned_text": planned_text,
                }
            )

    state["last_check_at"] = now.isoformat(timespec="seconds")
    if not items:
        state["sent_today"] = sum(
            1 for key in state["sent"] if key.startswith(now.date().isoformat() + "|")
        )
        save_state(state)
        return backup

    retry_configuration = {
        "smtp_host": str(settings.get("smtp_host") or "").strip().rstrip(".").casefold(),
        "smtp_port": int(settings.get("smtp_port") or 465),
        "smtp_security": str(settings.get("smtp_security") or "ssl").casefold(),
        "smtp_username": str(settings.get("smtp_username") or "").strip().casefold(),
        "smtp_sender": str(settings.get("smtp_sender") or "").strip().casefold(),
        "recipients": recipients,
        "reminder_time": str(settings.get("reminder_time") or "09:00"),
        "advance_days": advance_days,
        "weekdays": settings.get("reminder_weekdays") or [],
    }
    configuration_hash = hashlib.sha256(
        json.dumps(
            retry_configuration,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    attempt_key = f"{now.date().isoformat()}|{configuration_hash}"
    attempt = state["attempts"].get(attempt_key, {"count": 0, "last_attempt_at": None})
    if int(attempt.get("count", 0)) >= 3:
        return backup
    last_attempt = attempt.get("last_attempt_at")
    if last_attempt:
        try:
            if now - datetime.fromisoformat(last_attempt) < timedelta(minutes=15):
                return backup
        except (TypeError, ValueError):
            pass

    attempt = {
        "count": int(attempt.get("count", 0)) + 1,
        "last_attempt_at": now.isoformat(timespec="seconds"),
    }
    state["attempts"][attempt_key] = attempt

    content = settings.get("reminder_content") or {}
    lines = ["以下流程节点即将到期，请及时跟进：", ""]
    for index, item in enumerate(items, 1):
        project = item["project"]
        lines.append(f"{index}. {item['stage_name']}")
        if content.get("project_number", True):
            lines.append(f"项目编号：{getattr(project, 'number', '') or '-'}")
        if content.get("project_name", True):
            lines.append(f"项目名称：{getattr(project, 'name', '') or '-'}")
        if content.get("purchaser", True):
            lines.append(f"采购人：{getattr(project, 'purchaser', '') or '-'}")
        if item["stage_key"] == "bid_opening":
            lines.append(f"开标时间：{item['planned'].strftime('%Y-%m-%d %H:%M')}")
        elif content.get("planned_at", True):
            lines.append(f"计划时间：{item['planned_text']}")
        if item["stage_key"] == "registration_end" and content.get("registration_count", True):
            count = len(list(getattr(project, "registrations", None) or []))
            lines.append(f"{count} 家供应商已报名")
        lines.append("")

    message = EmailMessage()
    subject_template = settings.get("reminder_subject") or "采购执行提醒：{date} 共 {count} 个节点"
    try:
        subject = subject_template.format(date=now.date().isoformat(), count=len(items))
    except (KeyError, IndexError):
        subject = subject_template
    message["Subject"] = subject
    message["From"] = str(settings.get("smtp_sender") or "")
    message["To"] = ", ".join(recipients)
    message.set_content("\n".join(lines))

    host = str(settings.get("smtp_host") or "")
    normalized_host = host.strip().rstrip(".").casefold()
    if normalized_host in {"smtp-mail.outlook.com", "smtp.office365.com"}:
        state["last_error"] = "SMTP_OAUTH_REQUIRED: Outlook 需要 OAuth2"
        save_state(state)
        return backup

    try:
        if not credential_path.is_file():
            raise RuntimeError("SMTP 密码尚未配置")
        password = unprotect_secret(credential_path.read_bytes()).decode("utf-8")
        factory = globals().get("_REMINDER_SMTP_FACTORY")
        port = int(settings.get("smtp_port") or 465)
        security = str(settings.get("smtp_security") or "ssl")
        if security == "ssl":
            constructor = factory or smtplib.SMTP_SSL
            connection = constructor(host, port, timeout=15, context=ssl.create_default_context())
        else:
            constructor = factory or smtplib.SMTP
            connection = constructor(host, port, timeout=15)
        with connection as smtp:
            if security == "starttls":
                smtp.starttls(context=ssl.create_default_context())
            username = str(settings.get("smtp_username") or "")
            if username:
                smtp.login(username, password)
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError:
        state["last_error"] = "SMTP_AUTH_FAILED: SMTP 身份验证失败"
        save_state(state)
        return backup
    except ssl.SSLError:
        state["last_error"] = "SMTP_TLS_FAILED: SMTP TLS 协商失败"
        save_state(state)
        return backup
    except (TimeoutError, OSError):
        state["last_error"] = "SMTP_CONNECTION_FAILED: 无法连接 SMTP 服务器"
        save_state(state)
        return backup
    except smtplib.SMTPException:
        state["last_error"] = "SMTP_SEND_FAILED: SMTP 服务器拒绝发送"
        save_state(state)
        return backup
    except Exception:
        state["last_error"] = "SMTP_SEND_FAILED: 邮件发送失败"
        save_state(state)
        return backup

    sent_at = now.isoformat(timespec="seconds")
    for item in items:
        state["sent"][item["dedupe_key"]] = sent_at
    state["last_success_at"] = sent_at
    state["last_error"] = None
    state["sent_today"] = sum(
        1 for key in state["sent"] if key.startswith(now.date().isoformat() + "|")
    )
    save_state(state)
    return backup

def _auto_advance_stages():
    import json
    import os
    import lot_supplier_risk
    from datetime import timedelta
    try:
        import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates

    now_hook = globals().get("_AUTO_COMPLETION_NOW")
    now = now_hook() if now_hook else datetime.now()
    state_path = SETTINGS_PATH.with_name("stage_auto_completion_state.json")
    audit_path = SETTINGS_PATH.with_name("stage_auto_completion_log.jsonl")

    def write_atomic(path, value):
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(value, encoding="utf-8")
        os.replace(temporary, path)

    def ensure_audit_table(cursor):
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS stage_auto_completion_audit ("
            "sequence INTEGER PRIMARY KEY AUTOINCREMENT, "
            "event_id TEXT NOT NULL UNIQUE, "
            "transaction_id TEXT NOT NULL, "
            "project_id INTEGER NOT NULL, "
            "stage_key TEXT NOT NULL, "
            "payload_json TEXT NOT NULL, "
            "created_at TEXT NOT NULL)"
        )

    def export_committed_audit():
        connection = None
        temporary = audit_path.with_suffix(audit_path.suffix + ".tmp")
        try:
            connection = db.engine.raw_connection()
            cursor = connection.cursor()
            ensure_audit_table(cursor)
            connection.commit()
            rows = cursor.execute(
                "SELECT payload_json FROM stage_auto_completion_audit "
                "ORDER BY sequence"
            ).fetchall()
            with temporary.open("w", encoding="utf-8", newline="\n") as stream:
                for row in rows:
                    record = json.loads(row[0])
                    stream.write(
                        json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
                    )
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, audit_path)
        except Exception as exc:
            temporary.unlink(missing_ok=True)
            print(f"Auto-completion audit export error: {exc}")
        finally:
            if connection is not None:
                connection.close()

    if not state_path.is_file():
        enabled_at = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
        state = {
            "version": 1,
            "enabled_at": enabled_at.isoformat(timespec="seconds"),
            "initialized_at": now.isoformat(timespec="seconds"),
        }
        try:
            write_atomic(
                state_path,
                json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            )
        except (OSError, UnicodeError) as exc:
            print(f"Auto-completion state initialization error: {exc}")
        return

    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(state, dict) or state.get("version") != 1:
            raise ValueError("invalid auto-completion state")
        enabled_at = datetime.fromisoformat(str(state.get("enabled_at") or ""))
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"Auto-completion state error: {exc}")
        return

    def normalize(value):
        if isinstance(value, datetime):
            parsed = value
        elif hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
            parsed = datetime(value.year, value.month, value.day)
        else:
            raw = str(value or "").strip().replace("Z", "+00:00")
            if not raw:
                return None
            try:
                parsed = datetime.fromisoformat(raw)
            except ValueError:
                return None
        if getattr(parsed, "tzinfo", None) is not None:
            parsed = parsed.astimezone().replace(tzinfo=None)
        return parsed

    enabled_at = normalize(enabled_at)
    local_now = normalize(now)
    if enabled_at is None or local_now is None:
        print("Auto-completion state error: invalid scheduling timestamp")
        return

    settings = load_app_settings()
    legacy_auto_keys = [
        key
        for key in stage_workflow.normalize_stage_order(
            settings.get("stage_order"), globals().get("STAGES", [])
        )
        if key in stage_templates.LEGACY_AUTO_COMPLETION_STAGE_KEYS
    ]
    changed = []
    previous_values = []
    with app.app_context():
        lot_supplier_risk.ensure_schema(db, commit=True)
        export_committed_audit()
        projects = Project.query.options(
            joinedload(Project.stages),
            joinedload(Project.lots),
            joinedload(Project.registrations),
        ).filter_by(
            is_terminated=False
        ).all()
        session_connection = db.session.connection()
        explicit_policies = stage_templates.auto_completion_policies(
            session_connection,
            globals().get("text", lambda value: value),
        )
        for project in projects:
            if getattr(project, "is_terminated", False):
                continue
            project_id = int(getattr(project, "id"))
            policy = explicit_policies.get(project_id)
            if policy is None:
                auto_keys = legacy_auto_keys
                registration_keys = {"registration_end"}
            else:
                auto_keys = [
                    str(getattr(stage, "stage_key", ""))
                    for stage in list(getattr(project, "stages", ()) or ())
                    if "auto_completion" in policy.get(
                        str(getattr(stage, "stage_key", "")), set()
                    )
                ]
                registration_keys = {
                    stage_key
                    for stage_key, modules in policy.items()
                    if "registration" in modules
                }
            for stage_key in auto_keys:
                stage = project.get_stage(stage_key)
                if stage is None:
                    continue
                if getattr(stage, "completed", False) or getattr(stage, "skipped", False):
                    continue
                planned = normalize(getattr(stage, "planned_datetime", None))
                if planned is None or planned < enabled_at or planned > local_now:
                    continue
                if stage_key in registration_keys:
                    try:
                        lot_supplier_risk.apply_registration_cutoff(
                            db, project, local_now, load_app_settings()
                        )
                    except Exception as exc:
                        db.session.rollback()
                        print(f"Lot supplier cutoff error: {exc}")
                        continue
                previous_values.append(
                    (
                        stage,
                        getattr(stage, "completed", False),
                        getattr(stage, "completed_date", None),
                    )
                )
                stage.completed = True
                stage.completed_date = local_now.date()
                changed.append(
                    {
                        "action": "auto_complete_stage",
                        "completed_date": local_now.date().isoformat(),
                        "executed_at": local_now.isoformat(timespec="seconds"),
                        "planned_at": planned.isoformat(timespec="seconds"),
                        "project_id": getattr(project, "id", None),
                        "stage_key": stage_key,
                    }
                )

        if not changed:
            return

        def rollback_changes():
            db.session.rollback()
            for stage, completed, completed_date in previous_values:
                stage.completed = completed
                stage.completed_date = completed_date

        try:
            session_connection = db.session.connection()
            driver_connection = getattr(
                session_connection, "connection", session_connection
            )
            audit_cursor = driver_connection.cursor()
            ensure_audit_table(audit_cursor)
            transaction_id = "auto_completion|" + local_now.isoformat(
                timespec="seconds"
            )
            for record in changed:
                payload = json.dumps(record, ensure_ascii=False, sort_keys=True)
                event_id = "|".join(
                    (
                        str(record["project_id"]),
                        record["stage_key"],
                        record["planned_at"],
                    )
                )
                audit_cursor.execute(
                    "INSERT OR IGNORE INTO stage_auto_completion_audit "
                    "(event_id, transaction_id, project_id, stage_key, payload_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        event_id,
                        transaction_id,
                        record["project_id"],
                        record["stage_key"],
                        payload,
                        record["executed_at"],
                    ),
                )
            db.session.commit()
        except (Exception, KeyboardInterrupt) as exc:
            rollback_changes()
            print(f"Auto-completion commit error: {exc}")
            return

        export_committed_audit()


def api_export():
    from io import BytesIO
    from urllib.parse import quote
    from xml.sax.saxutils import escape
    from zipfile import ZIP_DEFLATED, ZipFile
    import signed_attachments
    try:
        import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow

    selected_year = request.args.get("year", "").strip()
    query = Project.query.options(
        joinedload(Project.stages), joinedload(Project.lots), joinedload(Project.bid_results)
    )
    if selected_year:
        query = query.filter(Project.year == selected_year)
    projects = query.order_by(Project.year.desc(), Project.number.desc()).all()

    headers = [
        "序号",
        "项目编号",
        "项目名称",
        "采购人",
        "年度",
        "采购方式",
        "项目预算(元)",
        "包号",
        "包名",
        "包预算(元)",
        "公告发布时间",
        "开标时间",
        "当前阶段",
        "项目状态",
        "进度%",
        "中标/成交供应商",
        "中标金额/折扣率",
        "备注",
        "附件链接",
    ]
    widths = [6, 20, 38, 26, 8, 13, 14, 10, 24, 14, 14, 14, 12, 10, 8, 26, 18, 34, 46]

    def display_date(value):
        if not value:
            return ""
        if hasattr(value, "strftime"):
            return value.strftime("%Y-%m-%d")
        return str(value)

    def stage_date(stages, stage_key):
        for stage in stages:
            if getattr(stage, "stage_key", None) == stage_key:
                return display_date(
                    getattr(stage, "completed_date", None)
                    or getattr(stage, "planned_datetime", None)
                )
        return ""

    def bid_values(bids):
        suppliers = []
        amounts = []
        for bid in bids:
            supplier = getattr(bid, "winning_supplier", None)
            amount = getattr(bid, "winning_amount", None) or getattr(
                bid, "discount_rate", None
            )
            if supplier:
                suppliers.append(str(supplier))
            if amount:
                amounts.append(str(amount))
        return "、".join(suppliers), "、".join(amounts)

    def project_status(project):
        if getattr(project, "is_terminated", False):
            terminated_type = getattr(project, "terminated_type", None)
            if terminated_type in ("流标", "废标", "终止"):
                return terminated_type
            return "已终止"
        try:
            completed = float(getattr(project, "progress", 0) or 0) >= 100
        except (TypeError, ValueError):
            completed = False
        return "已完成" if completed else "进行中"

    settings = load_app_settings()
    ordered_stages = stage_workflow.ordered_stage_definitions(STAGES, settings)
    stage_order = [stage["key"] for stage in ordered_stages]
    stage_names = {stage["key"]: stage["name"] for stage in ordered_stages}
    generated_at = datetime.now()
    attachment_expires_at = int(generated_at.timestamp()) + 7 * 24 * 60 * 60
    attachment_secret = None
    base_url = str(getattr(request, "host_url", "") or "").rstrip("/")
    if "127.0.0.1" in base_url or "localhost" in base_url:
        try:
            import socket
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                probe.connect(("10.255.255.255", 1))
                local_ip = probe.getsockname()[0]
            except Exception:
                local_ip = socket.gethostbyname(socket.gethostname())
            finally:
                probe.close()
            if local_ip and not local_ip.startswith("127."):
                host_str = str(getattr(request, "host", "") or "")
                port = host_str.split(":")[-1] if ":" in host_str else "5001"
                base_url = f"http://{local_ip}:{port}"
        except Exception:
            pass
    attachment_catalog = []
    rows = []
    for project in projects:
        stages = list(getattr(project, "stages", None) or [])
        lots = list(getattr(project, "lots", None) or [])
        bid_results = list(getattr(project, "bid_results", None) or [])
        project_attachments = []
        attachment_model = globals().get("Attachment")
        if attachment_model is not None and hasattr(attachment_model, "query"):
            try:
                project_attachments = attachment_model.query.filter_by(
                    project_id=project.id
                ).all()
            except Exception:
                project_attachments = []
        attachment_names = []
        attachment_first_url = ""
        for attachment in project_attachments:
            attachment_names.append(getattr(attachment, "filename", None) or f"附件{attachment.id}")
            if not attachment_first_url:
                if attachment_secret is None:
                    attachment_secret = signed_attachments.get_or_create_secret(DATA_DIR)
                attachment_first_url = signed_attachments.build_signed_url(
                    base_url,
                    attachment.id,
                    attachment_expires_at,
                    attachment_secret,
                )
        if attachment_first_url:
            attachment_display = (
                attachment_names[0]
                if len(attachment_names) == 1
                else f"附件({len(attachment_names)}个)"
            )
            attachment_links = f"HYPERLINK::{attachment_first_url}::{attachment_display}"
        else:
            attachment_links = ""
        for attachment in project_attachments:
            if attachment_secret is None:
                attachment_secret = signed_attachments.get_or_create_secret(DATA_DIR)
            attachment_catalog.append(
                {
                    "project_number": getattr(project, "number", None) or "",
                    "project_name": getattr(project, "name", None) or "",
                    "year": getattr(project, "year", None) or "",
                    "filename": getattr(attachment, "filename", None) or f"附件{attachment.id}",
                    "expires_at": datetime.fromtimestamp(attachment_expires_at).strftime("%Y-%m-%d %H:%M:%S"),
                    "url": signed_attachments.build_signed_url(
                        base_url,
                        attachment.id,
                        attachment_expires_at,
                        attachment_secret,
                    ),
                }
            )
        progress = getattr(project, "progress", None)
        current_stage_key = getattr(project, "current_stage_key", None)
        if "stage_order" in settings:
            project_stage_by_key = {
                getattr(stage, "stage_key", None) or getattr(stage, "key", None): stage
                for stage in stages
            }
            current_stage_key = next(
                (
                    key
                    for key in stage_order
                    if key in project_stage_by_key
                    and not bool(getattr(project_stage_by_key[key], "completed", False))
                    and not bool(getattr(project_stage_by_key[key], "skipped", False))
                ),
                None,
            )
        current_stage = (
            "网上竞价"
            if current_stage_key == "online_bidding"
            else stage_names.get(current_stage_key, "")
        )
        common_values = [
            getattr(project, "number", None) or "",
            getattr(project, "name", None) or "",
            getattr(project, "purchaser", None) or "",
            getattr(project, "year", None) or "",
            getattr(project, "method", None) or "",
            getattr(project, "budget", None) if getattr(project, "budget", None) is not None else "",
            stage_date(stages, "announcement"),
            stage_date(stages, "bid_opening"),
            current_stage,
            project_status(project),
            progress if progress is not None else "",
            getattr(project, "notes", None) or "",
        ]

        if lots:
            for lot in lots:
                lot_bids = [
                    bid
                    for bid in bid_results
                    if getattr(bid, "lot_id", None) == getattr(lot, "id", None)
                ]
                suppliers, amounts = bid_values(lot_bids)
                rows.append(
                    [
                        common_values[0],
                        common_values[1],
                        common_values[2],
                        common_values[3],
                        common_values[4],
                        common_values[5],
                        getattr(lot, "lot_number", None) or "",
                        getattr(lot, "lot_name", None) or "",
                        getattr(lot, "budget", None)
                        if getattr(lot, "budget", None) is not None
                        else "",
                        common_values[6],
                        common_values[7],
                        common_values[8],
                        common_values[9],
                        common_values[10],
                        suppliers,
                        amounts,
                        common_values[11],
                        attachment_links,
                    ]
                )
        else:
            suppliers, amounts = bid_values(bid_results)
            rows.append(
                [
                    common_values[0],
                    common_values[1],
                    common_values[2],
                    common_values[3],
                    common_values[4],
                    common_values[5],
                    "",
                    "",
                    "",
                    common_values[6],
                    common_values[7],
                    common_values[8],
                    common_values[9],
                    common_values[10],
                    suppliers,
                    amounts,
                    common_values[11],
                    attachment_links,
                ]
            )

    def cell_ref(column, row):
        letters = ""
        while column:
            column, remainder = divmod(column - 1, 26)
            letters = chr(65 + remainder) + letters
        return f"{letters}{row}"

    def xml_text(value):
        text = "" if value is None else str(value)
        text = "".join(
            character
            for character in text
            if ord(character) in (0x09, 0x0A, 0x0D)
            or 0x20 <= ord(character) <= 0xD7FF
            or 0xE000 <= ord(character) <= 0xFFFD
            or 0x10000 <= ord(character) <= 0x10FFFF
        )
        return escape(text)

    def cell_xml(row, column, value, style):
        attributes = f' r="{cell_ref(column, row)}" s="{style}"'
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f"<c{attributes}><v>{value}</v></c>"
        text = "" if value is None else str(value)
        if not text:
            return f"<c{attributes}/>"
        if text.startswith("HYPERLINK::"):
            parts = text.split("::", 2)
            if len(parts) == 3:
                url, display = parts[1], parts[2]
                url_formula = url.replace('"', '""')
                display_formula = display.replace('"', '""')
                formula = f'HYPERLINK("{url_formula}", "{display_formula}")'
                return f'<c{attributes}><f>{xml_text(formula)}</f></c>'
        preserve = ' xml:space="preserve"' if text != text.strip() else ""
        return f'<c{attributes} t="inlineStr"><is><t{preserve}>{xml_text(text)}</t></is></c>'

    def row_xml(row_number, values, style, status_style=None):
        cells = []
        for column, value in enumerate(values, 1):
            cell_style = status_style if column == 14 and status_style is not None else style
            cells.append(cell_xml(row_number, column, value, cell_style))
        return f'<row r="{row_number}">{"".join(cells)}</row>'

    status_styles = {"已完成": 6, "进行中": 7, "流标": 8, "废标": 8, "终止": 8, "已终止": 8}
    title = "项目导出清单"
    year_label = selected_year or "全部年份"

    def filename_component(value, fallback, ascii_only=False):
        component = []
        pending_separator = False
        for character in str(value):
            allowed = character.isalnum() or character in ("-", "_")
            if ascii_only:
                allowed = allowed and character.isascii()
            if allowed:
                if pending_separator and component:
                    component.append("_")
                component.append(character)
                pending_separator = False
            else:
                pending_separator = True
        return "".join(component).strip("_-") or fallback

    filename_year = (
        filename_component(selected_year, "year") if selected_year else "全部年份"
    )
    metadata = (
        f"导出时间：{generated_at.strftime('%Y-%m-%d %H:%M:%S')}    "
        f"筛选年份：{year_label}    项目数：{len(projects)}"
    )
    sheet_rows = [
        f'<row r="1">{cell_xml(1, 1, title, 1)}</row>',
        f'<row r="2">{cell_xml(2, 1, metadata, 2)}</row>',
        row_xml(4, headers, 3),
    ]
    if rows:
        for row_number, values in enumerate(rows, 5):
            style = 5 if (row_number - 5) % 2 else 0
            status = values[12]
            sheet_rows.append(row_xml(row_number, [row_number - 4, *values], style, status_styles.get(status)))
        last_row = 4 + len(rows)
        merges = '<mergeCell ref="A1:S1"/><mergeCell ref="A2:S2"/>'
    else:
        sheet_rows.append(f'<row r="5">{cell_xml(5, 1, "暂无符合条件的数据", 4)}</row>')
        last_row = 5
        merges = '<mergeCell ref="A1:S1"/><mergeCell ref="A2:S2"/><mergeCell ref="A5:S5"/>'

    cols = "".join(
        f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        for index, width in enumerate(widths, 1)
    )
    sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>
  <cols>{cols}</cols>
  <sheetData>{"".join(sheet_rows)}</sheetData>
  <autoFilter ref="A4:S{last_row}"/>
  <mergeCells count="{3 if not rows else 2}">{merges}</mergeCells>
</worksheet>'''

    def sheet_cell_xml(row, column, value, link_url=None):
        letters = ""
        while column:
            column, remainder = divmod(column - 1, 26)
            letters = chr(65 + remainder) + letters
        ref = f"{letters}{row}"
        style = 3 if row == 1 else 0
        attributes = f' r="{ref}" s="{style}"'
        text = "" if value is None else str(value)
        escaped = xml_text(text)
        if link_url:
            url_formula = link_url.replace('"', '""')
            formula = f'HYPERLINK("{url_formula}", "{text.replace(chr(34), chr(34) * 2)}")'
            return f'<c{attributes}><f>{xml_text(formula)}</f></c>'
        if not text:
            return f'<c{attributes}/>'
        return f'<c{attributes} t="inlineStr"><is><t>{escaped}</t></is></c>'

    sheet2_rows = [
        '<row r="1">'
        + sheet_cell_xml(1, 1, "项目编号")
        + sheet_cell_xml(1, 2, "项目名称")
        + sheet_cell_xml(1, 3, "年度")
        + sheet_cell_xml(1, 4, "附件文件名")
        + sheet_cell_xml(1, 5, "链接到期时间")
        + sheet_cell_xml(1, 6, "下载链接")
        + '</row>'
    ]
    for catalog_index, item in enumerate(attachment_catalog, start=2):
        sheet2_rows.append(
            f'<row r="{catalog_index}">'
            + sheet_cell_xml(catalog_index, 1, item["project_number"])
            + sheet_cell_xml(catalog_index, 2, item["project_name"])
            + sheet_cell_xml(catalog_index, 3, item["year"])
            + sheet_cell_xml(catalog_index, 4, item["filename"])
            + sheet_cell_xml(catalog_index, 5, item["expires_at"])
            + sheet_cell_xml(catalog_index, 6, "下载", item["url"])
            + '</row>'
        )
    if not attachment_catalog:
        sheet2_rows.append('<row r="2">' + sheet_cell_xml(2, 1, "暂无附件") + '</row>')
    sheet2_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>{"".join(sheet2_rows)}</sheetData>
</worksheet>'''
    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7FBF9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''
    content_types_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'''
    package_relationships_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'''
    workbook_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="项目导出" sheetId="1" r:id="rId1"/><sheet name="附件清单" sheetId="2" r:id="rId3"/></sheets></workbook>'''
    workbook_relationships_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'''
    app_properties_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Project Management System</Application></Properties>'''
    core_properties_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Project Management System</dc:creator><cp:lastModifiedBy>Project Management System</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">{generated_at.strftime('%Y-%m-%dT%H:%M:%SZ')}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{generated_at.strftime('%Y-%m-%dT%H:%M:%SZ')}</dcterms:modified></cp:coreProperties>'''

    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("_rels/.rels", package_relationships_xml)
        archive.writestr("docProps/app.xml", app_properties_xml)
        archive.writestr("docProps/core.xml", core_properties_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_relationships_xml)
        archive.writestr("xl/styles.xml", styles_xml)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        archive.writestr("xl/worksheets/sheet2.xml", sheet2_xml)
    workbook_bytes = output.getvalue()

    today = date.today().strftime("%Y-%m-%d")
    filename = f"项目列表_{filename_year}_{today}.xlsx"

    def contained_export_path(export_dir, name):
        resolved_export_dir = export_dir.resolve()
        output_path = export_dir / name
        resolved_output_path = output_path.resolve()
        if resolved_export_dir not in resolved_output_path.parents:
            raise ValueError("export path must remain inside the export directory")
        return output_path

    if request.args.get("save") == "1":
        export_dir = get_export_dir()
        export_dir.mkdir(parents=True, exist_ok=True)
        output_path = contained_export_path(export_dir, filename)
        if output_path.exists():
            collision_filename = (
                f"项目列表_{filename_year}_{today}_{datetime.now().strftime('%H%M%S')}.xlsx"
            )
            output_path = contained_export_path(export_dir, collision_filename)
        output_path.write_bytes(workbook_bytes)
        log_operation("export_projects", "project", None, f"导出项目列表（{len(projects)}个）")
        return jsonify(
            {
                "message": "项目列表已导出",
                "filename": output_path.name,
                "path": str(output_path),
                "folder": str(export_dir),
                "year": selected_year,
                "count": len(projects),
            }
        )

    ascii_year = (
        filename_component(selected_year, "year", ascii_only=True)
        if selected_year
        else "all"
    )
    ascii_filename = f"ProjectList_{ascii_year}_{today}.xlsx"
    disposition = (
        f'attachment; filename="{ascii_filename}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    return app.response_class(
        workbook_bytes,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disposition},
    )


def get_export_dir():
    import sys
    from pathlib import Path
    configured = load_app_settings().get("export_folder") or ""
    base = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(DATA_DIR)
    default = base / "exports"
    folder = Path(configured).expanduser() if configured else default
    try:
        folder.mkdir(parents=True, exist_ok=True)
        return folder.resolve()
    except (OSError, ValueError):
        # A stale path from another Windows account must not break settings.
        # If even the default is unwritable, keep settings accessible so users
        # can select a valid folder; the actual file write reports its error.
        try:
            default.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        return default.resolve()
