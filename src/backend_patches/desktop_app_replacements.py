"""Replacement desktop entry point compiled into the packaged module."""


def _scheduler_loop():
    def log_failure(job_name):
        _log(f"Scheduler {job_name} error: SCHEDULED_JOB_FAILED")

    while not _SHOULD_EXIT:
        try:
            with server_app.app.app_context():
                scheduled = getattr(server_app, "run_scheduled_backup_if_due", None)
                if callable(scheduled):
                    backup_result = None
                    try:
                        backup_result = scheduled(job="backup")
                    except TypeError as exc:
                        if "unexpected keyword argument 'job'" not in str(exc):
                            log_failure("backup")
                        else:
                            try:
                                backup_result = scheduled()
                            except Exception:
                                log_failure("backup")
                                backup_result = None
                    except Exception:
                        log_failure("backup")
                        backup_result = None
                    else:
                        try:
                            scheduled(job="digest")
                        except Exception:
                            log_failure("digest")
                    if backup_result:
                        _log(f"Scheduled backup created: {backup_result}")

                jobs = (
                    ("project-event", getattr(server_app, "run_project_event_reminders_if_due", None)),
                    ("stage-completion", getattr(server_app, "_auto_advance_stages", None)),
                )
                for job_name, job in jobs:
                    if not callable(job):
                        continue
                    try:
                        job()
                    except Exception:
                        log_failure(job_name)
        except Exception:
            log_failure("context")
        time.sleep(60)


def main():
    import logging
    import os
    import sys
    from flask import jsonify, make_response, redirect, render_template_string, request, session
    from werkzeug.serving import WSGIRequestHandler

    global _SHOULD_EXIT, _TRAY_READY, _FLASK_THREAD, _WINDOW

    _SHOULD_EXIT = False
    _TRAY_READY = False
    parallel_test = os.environ.get("PROJECT_MGR_ALLOW_PARALLEL_TEST") == "1"
    acquired_instance = False if parallel_test else _acquire_single_instance()
    if not parallel_test and not acquired_instance:
        return

    port = _find_port()
    import data_import
    import data_recovery
    import data_security
    import device_admission
    import device_keyring
    import http_security
    import signed_attachments
    import online_bidding
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates

    online_bidding.register(server_app.app, server_app.db, {
        "Project": server_app.Project, "login_required": server_app.login_required,
    })

    data_import.register_routes(
        server_app.app,
        server_app.db,
        {
            "Project": server_app.Project,
            "ProjectLot": server_app.ProjectLot,
            "SupplierRegistration": server_app.SupplierRegistration,
            "get_export_dir": server_app.get_export_dir,
            "load_app_settings": server_app.load_app_settings,
            "METHODS": getattr(server_app, 'METHODS', stage_templates.PROCUREMENT_METHODS),
            "STAGES": getattr(server_app, 'STAGES', []),
        },
    )
    signed_attachments.register_routes(
        server_app.app,
        server_app.db,
        {
            "Attachment": server_app.Attachment,
            "DATA_DIR": server_app.DATA_DIR,
            "UPLOAD_FOLDER": server_app.UPLOAD_FOLDER,
            "attachment_response": server_app._attachment_response,
        },
    )
    data_recovery.register(
        server_app.app,
        {
            "DATA_DIR": server_app.DATA_DIR,
            "MASTER_KEY": server_app.MASTER_KEY,
            "db": server_app.db,
            "User": server_app.User,
            "protect_key": data_security._dpapi_protect,
            "choose_export_folder": lambda: _WINDOW.create_file_dialog(webview.FOLDER_DIALOG),
            "get_export_dir": server_app.get_export_dir,
        },
    )
    device_admission.register(
        server_app.app,
        server_app.db,
        {
            "DATA_DIR": server_app.DATA_DIR,
            "DB_PATH": server_app.DB_PATH,
            "MASTER_KEY": server_app.MASTER_KEY,
            "connect_encrypted": server_app.connect_encrypted,
            "device_keyring_module": device_keyring,
            "User": server_app.User,
            "session": session,
            "request": request,
            "jsonify": jsonify,
            "redirect": redirect,
            "make_response": make_response,
            "render_template_string": render_template_string,
            "signed_attachment_endpoints": {"api_download_signed_attachment"},
        },
    )
    http_security.install_http_security(
        server_app.app,
        request_handler_class=WSGIRequestHandler,
        access_loggers=[logging.getLogger("werkzeug")],
    )
    _FLASK_THREAD = FlaskThread(port)
    _FLASK_THREAD.start()
    threading.Thread(target=_scheduler_loop, daemon=True).start()

    local_url, lan_url, info_path = _write_lan_info(port)
    print(f"本机访问：{local_url}")
    print(f"局域网访问：{lan_url}")
    print(f"访问地址已写入：{info_path}")

    if "--headless" in sys.argv[1:]:
        try:
            while not _SHOULD_EXIT:
                time.sleep(0.2)
        finally:
            _FLASK_THREAD.shutdown()
            if acquired_instance:
                _release_single_instance()
        return

    startup_minimized = "--startup-minimized" in sys.argv[1:]
    icon_path = Path(server_app.RESOURCE_DIR) / "static" / "app-icon.ico"
    _WINDOW = webview.create_window(
        APP_NAME,
        local_url,
        width=1280,
        height=820,
        min_size=(1024, 680),
        background_color="#f6f8fb",
        hidden=startup_minimized,
    )

    def on_closing():
        if _SHOULD_EXIT:
            return
        if not _TRAY_READY:
            _log("Tray unavailable; closing desktop application normally")
            return
        threading.Timer(0.05, _WINDOW.hide).start()
        return False

    def on_closed():
        if _SHOULD_EXIT and _FLASK_THREAD:
            _FLASK_THREAD.shutdown()

    def on_started():
        try:
            _setup_tray(icon_path, lan_url)
        except Exception as exc:
            _log(f"pystray setup failed: {exc}")
            if startup_minimized:
                _show_window()

    def configure_client_autofill():
        # before_show runs on the native UI thread. Initialization may still be
        # pending, so apply on CoreWebView2InitializationCompleted as well.
        control = getattr(getattr(_WINDOW, "native", None), "webview", None)
        if control is None:
            return

        def apply_autofill_policy(sender=None, event=None):
            try:
                core = control.CoreWebView2
                if core is not None:
                    core.Settings.IsGeneralAutofillEnabled = False
            except Exception:
                _log("Client autofill policy unavailable: WEBVIEW_SETTINGS_FAILED")

        try:
            control.CoreWebView2InitializationCompleted += apply_autofill_policy
            apply_autofill_policy()
        except Exception:
            _log("Client autofill policy unavailable: WEBVIEW_SETTINGS_FAILED")

    _WINDOW.events.before_show += configure_client_autofill
    _WINDOW.events.closing += on_closing
    _WINDOW.events.closed += on_closed
    webview.start(
        on_started,
        icon=str(icon_path) if icon_path.exists() else None,
        private_mode=False,
    )

    try:
        if not _SHOULD_EXIT and _FLASK_THREAD:
            _FLASK_THREAD.shutdown()
    finally:
        if acquired_instance:
            _release_single_instance()
