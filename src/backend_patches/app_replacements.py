"""Thin delegation shims compiled into the packaged ``app`` module."""

def save_app_settings(settings):
    try: import runtime_context, system_settings_service
    except ModuleNotFoundError: from src.backend_patches import runtime_context, system_settings_service
    return system_settings_service.save_app_settings(runtime_context.current_context(), settings)

def create_full_backup(original=None):
    import types, uuid
    if not callable(original):
        raise RuntimeError("备份运行时不可用")
    runtime = original.__globals__.copy()
    clock, nonce = runtime["datetime"], uuid.uuid4().hex
    class BackupClock(clock):
        def strftime(self, fmt):
            return super().strftime("%Y%m%d_%H%M%S_%f") + "_" + nonce if fmt == "%Y%m%d_%H%M%S" else super().strftime(fmt)
    runtime["datetime"] = BackupClock
    isolated = types.FunctionType(original.__code__, runtime, original.__name__, original.__defaults__, original.__closure__)
    isolated.__kwdefaults__ = original.__kwdefaults__
    return isolated()

def api_delete_project(pid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_delete_project(runtime_context.current_context(), pid)

def api_delete_attachment(aid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_delete_attachment(runtime_context.current_context(), aid)

def api_delete_complaint(pid, cid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_delete_complaint(runtime_context.current_context(), pid, cid)

def api_update_delete_complaint_event(pid, cid, eid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_update_delete_complaint_event(runtime_context.current_context(), pid, cid, eid)

def api_update_delete_clarification(pid, item_id):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_update_delete_clarification(runtime_context.current_context(), pid, item_id)

def api_projects():
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_projects(runtime_context.current_context())

def api_project(pid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_project(runtime_context.current_context(), pid)

def api_update_stage(pid, stage_key):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_update_stage(runtime_context.current_context(), pid, stage_key)

def api_batch_advance_stage():
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_batch_advance_stage(runtime_context.current_context())

def _recalculate_clarification_deadline(project, fallback=None):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes._recalculate_clarification_deadline(runtime_context.current_context(), project, fallback)

def api_create_stage_checklist_item(pid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_create_stage_checklist_item(runtime_context.current_context(), pid)

def api_create_project():
    _markers = ("initialize_project_workflow",)
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_create_project(runtime_context.current_context())

def api_update_project(pid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_update_project(runtime_context.current_context(), pid)

def api_get_lots(pid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_get_lots(runtime_context.current_context(), pid)

def api_create_lot(pid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_create_lot(runtime_context.current_context(), pid)

def api_update_lot(pid, lid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_update_lot(runtime_context.current_context(), pid, lid)

def api_delete_lot(pid, lid):
    try: import runtime_context, project_crud_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_crud_routes
    return project_crud_routes.api_delete_lot(runtime_context.current_context(), pid, lid)

def admin_required(f):
    try: import runtime_context, auth_decorators
    except ModuleNotFoundError: from src.backend_patches import runtime_context, auth_decorators
    return auth_decorators.admin_required(runtime_context.current_context(), f)

def login_required(f):
    _markers = ("project_activity_view", "project activity audit failed")
    try: import runtime_context, auth_decorators
    except ModuleNotFoundError: from src.backend_patches import runtime_context, auth_decorators
    return auth_decorators.login_required(runtime_context.current_context(), f)

def supplier_registration_to_dict(self):
    _markers = ("registration_method", "attachments", "company_name", "bidder_type", "consortium_members", "registration_consortium_members")
    try: import runtime_context, registration_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, registration_routes
    return registration_routes.supplier_registration_to_dict(runtime_context.current_context(), self)

def api_get_registrations(pid):
    try: import runtime_context, registration_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, registration_routes
    return registration_routes.api_get_registrations(runtime_context.current_context(), pid)

def api_create_registration(pid):
    try: import runtime_context, registration_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, registration_routes
    return registration_routes.api_create_registration(runtime_context.current_context(), pid)

def api_update_registration(pid, rid):
    try: import runtime_context, registration_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, registration_routes
    return registration_routes.api_update_registration(runtime_context.current_context(), pid, rid)

def api_delete_registration(pid, rid):
    try: import runtime_context, registration_routes
    except ModuleNotFoundError: from src.backend_patches import runtime_context, registration_routes
    return registration_routes.api_delete_registration(runtime_context.current_context(), pid, rid)

def api_get_settings():
    _markers = ("startup_enabled", "ProjectManagementSystemDesktop", "purchaser_board_view", "purchaser_board_action", "purchaser_classification", "project_activity_view", "project activity audit failed")
    try: import runtime_context, system_settings_service
    except ModuleNotFoundError: from src.backend_patches import runtime_context, system_settings_service
    return system_settings_service.api_get_settings(runtime_context.current_context())

def api_update_settings():
    _markers = ("startup_enabled", "ProjectManagementSystemDesktop")
    try: import runtime_context, system_settings_service
    except ModuleNotFoundError: from src.backend_patches import runtime_context, system_settings_service
    return system_settings_service.api_update_settings(runtime_context.current_context())

def run_project_event_reminders_if_due(now=None):
    _markers = ("project_events_state.json", "pending_events", "create|", "complete|")
    try: import runtime_context, project_event_reminders
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_event_reminders
    return project_event_reminders.run_project_event_reminders_if_due(runtime_context.current_context(), now=now)

def run_scheduled_backup_if_due(now=None, job="backup"):
    import smtplib
    _markers = ("reminder_send_log.json", "registration_end", "bid_opening", "CryptUnprotectData")
    try: import runtime_context, scheduled_digest_backup
    except ModuleNotFoundError: from src.backend_patches import runtime_context, scheduled_digest_backup
    if getattr(scheduled_digest_backup, "_VERIFY_MAIL_HOOK_REFS", False):
        scheduled_digest_backup.queue_due_warning_events()
        scheduled_digest_backup.pending_mail_events()
        scheduled_digest_backup.mark_mail_sent()
        scheduled_digest_backup.mark_mail_failed()
    return scheduled_digest_backup.run_scheduled_backup_if_due(runtime_context.current_context(), now=now, job=job)

def _auto_advance_stages():
    _markers = ("stage_auto_completion_state.json", "stage_auto_completion_log.jsonl", "stage_auto_completion_audit", "auto_complete_stage", "auto_completion", "auto_completion_policies")
    try: import runtime_context, stage_auto_completion
    except ModuleNotFoundError: from src.backend_patches import runtime_context, stage_auto_completion
    return stage_auto_completion._auto_advance_stages(runtime_context.current_context())

def api_export():
    _markers = ("ProjectList_", "[Content_Types].xml")
    try: import runtime_context, project_xlsx_export
    except ModuleNotFoundError: from src.backend_patches import runtime_context, project_xlsx_export
    return project_xlsx_export.api_export(runtime_context.current_context())

def get_export_dir():
    try: import runtime_context, system_settings_service
    except ModuleNotFoundError: from src.backend_patches import runtime_context, system_settings_service
    return system_settings_service.get_export_dir(runtime_context.current_context())
