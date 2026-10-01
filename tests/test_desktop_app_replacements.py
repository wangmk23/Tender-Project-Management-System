import importlib.util
import io
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

from flask import Flask
from src.backend_patches import (
    data_import,
    data_recovery,
    device_admission,
    device_keyring,
    http_security,
    signed_attachments,
    online_bidding,
)


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "src" / "backend_patches" / "desktop_app_replacements.py"


class FakeEvent:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self


class FakeWindow:
    def __init__(self):
        self.events = types.SimpleNamespace(closing=FakeEvent(), closed=FakeEvent(), before_show=FakeEvent())
        self.show = Mock()
        self.restore = Mock()
        self.hide = Mock()
        self.destroy = Mock()


class FakeWebView:
    def __init__(self):
        self.window = FakeWindow()
        self.create_args = None
        self.create_kwargs = None
        self.start_args = None
        self.start_kwargs = None

    def create_window(self, *args, **kwargs):
        self.create_args = args
        self.create_kwargs = kwargs
        return self.window

    def start(self, *args, **kwargs):
        self.start_args = args
        self.start_kwargs = kwargs
        args[0]()


class FakeFlaskThread:
    def __init__(self, port):
        self.port = port
        self.started = False
        self.shutdown_called = False

    def start(self):
        self.started = True

    def shutdown(self):
        self.shutdown_called = True


class FakeBackgroundThread:
    def __init__(self, target=None, daemon=None):
        self.target = target
        self.daemon = daemon

    def start(self):
        return None


class FakeTimer(FakeBackgroundThread):
    def __init__(self, interval, function):
        super().__init__(target=function, daemon=True)
        self.interval = interval


class TrackingAppContext:
    def __init__(self, state):
        self.state = state

    def __enter__(self):
        self.state["active"] = True

    def __exit__(self, exc_type, exc, traceback):
        self.state["active"] = False


def load_replacements():
    if not MODULE_PATH.is_file():
        raise AssertionError(f"missing replacement module: {MODULE_PATH}")
    spec = importlib.util.spec_from_file_location("desktop_replacements_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DesktopAppReplacementTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        icon = self.temp_path / "static" / "app-icon.ico"
        icon.parent.mkdir(parents=True)
        icon.write_bytes(b"icon")

        self.module = load_replacements()
        self.webview = FakeWebView()
        self.module._SHOULD_EXIT = False
        self.module._TRAY_READY = False
        self.module._WINDOW = None
        self.module._FLASK_THREAD = None
        self.module._acquire_single_instance = Mock(return_value=True)
        self.module._find_port = Mock(return_value=5011)
        self.module.FlaskThread = FakeFlaskThread
        self.module.threading = types.SimpleNamespace(
            Thread=FakeBackgroundThread,
            Timer=FakeTimer,
        )
        self.scheduler_loop = getattr(self.module, "_scheduler_loop", None)
        self.module._scheduler_loop = Mock()
        self.module._write_lan_info = Mock(
            return_value=(
                "http://127.0.0.1:5011",
                "http://192.168.1.8:5011",
                self.temp_path / "局域网访问地址.txt",
            )
        )
        self.online_module_patch = patch.dict(sys.modules, {"online_bidding": online_bidding})
        self.online_module_patch.start()
        self.addCleanup(self.online_module_patch.stop)
        self.previous_data_import = sys.modules.get("data_import")
        self.previous_data_recovery = sys.modules.get("data_recovery")
        self.previous_data_security = sys.modules.get("data_security")
        self.previous_signed_attachments = sys.modules.get("signed_attachments")
        self.previous_device_admission = sys.modules.get("device_admission")
        self.previous_device_keyring = sys.modules.get("device_keyring")
        self.previous_http_security = sys.modules.get("http_security")
        sys.modules["data_import"] = data_import
        sys.modules["data_recovery"] = data_recovery
        sys.modules["data_security"] = types.SimpleNamespace(
            _dpapi_protect=lambda raw: b"wrapped:" + bytes(raw)
        )
        sys.modules["signed_attachments"] = signed_attachments
        sys.modules["device_admission"] = device_admission
        sys.modules["device_keyring"] = device_keyring
        sys.modules["http_security"] = http_security
        data_import._IMPORT_ROUTES_REGISTERED = False
        flask_app = Flask(f"desktop-test-{id(self)}")
        model = type("Model", (), {})
        fake_db = types.SimpleNamespace(session=types.SimpleNamespace(get=lambda *_: None))
        self.module.server_app = types.SimpleNamespace(
            app=flask_app,
            db=fake_db,
            Project=model,
            login_required=lambda fn: fn,
            ProjectLot=model,
            SupplierRegistration=model,
            Attachment=model,
            DATA_DIR=self.temp_path,
            DB_PATH=self.temp_path / "bidding.db",
            MASTER_KEY=b"m" * 32,
            connect_encrypted=lambda path, key, readonly: sqlite3.connect(path),
            User=type("User", (), {}),
            UPLOAD_FOLDER=self.temp_path / "uploads",
            get_export_dir=lambda: self.temp_path / "exports",
            load_app_settings=lambda: {}, METHODS=[], STAGES=[],
            _attachment_response=Mock(name="attachment_response"),
            send_file=lambda *args, **kwargs: None,
            RESOURCE_DIR=self.temp_path,
        )
        self.module.webview = self.webview
        self.module.APP_NAME = "项目管理系统"
        self.module._setup_tray = Mock()
        self.module._show_window = Mock()
        self.module._log = Mock()
        self.module._release_single_instance = Mock()
        self.module.Path = Path

    def tearDown(self):
        data_import._IMPORT_ROUTES_REGISTERED = False
        if self.previous_data_import is None:
            sys.modules.pop("data_import", None)
        else:
            sys.modules["data_import"] = self.previous_data_import
        if self.previous_data_recovery is None:
            sys.modules.pop("data_recovery", None)
        else:
            sys.modules["data_recovery"] = self.previous_data_recovery
        if self.previous_data_security is None:
            sys.modules.pop("data_security", None)
        else:
            sys.modules["data_security"] = self.previous_data_security
        if self.previous_signed_attachments is None:
            sys.modules.pop("signed_attachments", None)
        else:
            sys.modules["signed_attachments"] = self.previous_signed_attachments
        if self.previous_device_admission is None:
            sys.modules.pop("device_admission", None)
        else:
            sys.modules["device_admission"] = self.previous_device_admission
        if self.previous_device_keyring is None:
            sys.modules.pop("device_keyring", None)
        else:
            sys.modules["device_keyring"] = self.previous_device_keyring
        if self.previous_http_security is None:
            sys.modules.pop("http_security", None)
        else:
            sys.modules["http_security"] = self.previous_http_security
        self.temp_dir.cleanup()

    def test_main_registers_extension_routes_before_server_construction(self):
        flask_app = Flask("startup-route-test")
        observed_rules = []

        class RouteInspectingFlaskThread(FakeFlaskThread):
            def __init__(thread_self, port):
                observed_rules.extend(rule.rule for rule in flask_app.url_map.iter_rules())
                super().__init__(port)

        model = type("Model", (), {})
        self.module.FlaskThread = RouteInspectingFlaskThread
        self.module.server_app = types.SimpleNamespace(
            app=flask_app,
            db=types.SimpleNamespace(session=types.SimpleNamespace(get=lambda *_: None)),
            Project=model,
            login_required=lambda fn: fn,
            ProjectLot=model,
            SupplierRegistration=model,
            Attachment=model,
            DATA_DIR=self.temp_path,
            DB_PATH=self.temp_path / "route-bidding.db",
            MASTER_KEY=b"m" * 32,
            connect_encrypted=lambda path, key, readonly: sqlite3.connect(path),
            User=type("User", (), {}),
            UPLOAD_FOLDER=self.temp_path / "uploads",
            get_export_dir=lambda: self.temp_path / "exports",
            load_app_settings=lambda: {}, METHODS=[], STAGES=[],
            _attachment_response=Mock(name="attachment_response"),
            send_file=lambda *args, **kwargs: None,
            RESOURCE_DIR=self.temp_path,
        )
        data_import._IMPORT_ROUTES_REGISTERED = False
        with redirect_stdout(io.StringIO()), patch.object(
            sys, "argv", ["candidate.exe"]
        ):
            self.module.main()

        self.assertIn("/api/import/templates", observed_rules)
        self.assertIn("/api/data-recovery/bind", observed_rules)
        self.assertIn(
            "/api/public/attachments/<int:aid>/download",
            observed_rules,
        )

    def test_main_injects_the_packaged_attachment_response_pipeline(self):
        with patch.object(signed_attachments, "register_routes") as register, redirect_stdout(
            io.StringIO()
        ), patch.object(sys, "argv", ["candidate.exe"]):
            self.module.main()

        models = register.call_args.args[2]
        self.assertIs(
            models["attachment_response"],
            self.module.server_app._attachment_response,
        )
        self.assertNotIn("send_file", models)

    def test_main_supports_packaged_app_without_methods_or_stages_constants(self):
        del self.module.server_app.METHODS
        del self.module.server_app.STAGES
        with patch.object(data_import, 'register_routes') as register, redirect_stdout(io.StringIO()), patch.object(sys, 'argv', ['candidate.exe']):
            self.module.main()
        from src.backend_patches import stage_templates
        models = register.call_args.args[2]
        self.assertEqual(models['METHODS'], stage_templates.PROCUREMENT_METHODS)
        self.assertEqual(models['STAGES'], [])

    def test_main_registers_device_gate_and_http_security_before_server_construction(self):
        observations = []

        class InspectingFlaskThread(FakeFlaskThread):
            def __init__(thread_self, port):
                observations.append("server")
                super().__init__(port)

        self.module.FlaskThread = InspectingFlaskThread
        with patch.object(device_admission, "register", side_effect=lambda *args: observations.append(("admission", args[2]))) as register, patch.object(
            http_security, "install_http_security", side_effect=lambda *args, **kwargs: observations.append(("security", kwargs))
        ) as install, redirect_stdout(io.StringIO()), patch.object(sys, "argv", ["candidate.exe"]):
            self.module.main()

        self.assertEqual(observations[-1], "server")
        self.assertEqual([item[0] for item in observations[:-1]], ["admission", "security"])
        runtime = register.call_args.args[2]
        self.assertEqual(runtime["signed_attachment_endpoints"], {"api_download_signed_attachment"})
        self.assertIs(runtime["DATA_DIR"], self.module.server_app.DATA_DIR)
        self.assertIs(runtime["device_keyring_module"], device_keyring)
        install.assert_called_once()

    def test_normal_launch_creates_visible_window(self):
        with redirect_stdout(io.StringIO()), patch.object(
            sys, "argv", ["项目管理系统_桌面版.exe"]
        ):
            self.module.main()

        self.assertIs(self.webview.create_kwargs["hidden"], False)

    def test_client_disables_general_autofill_when_webview_initializes(self):
        core_settings = types.SimpleNamespace(IsGeneralAutofillEnabled=True, IsPasswordAutosaveEnabled=True)
        control = types.SimpleNamespace(CoreWebView2=None, CoreWebView2InitializationCompleted=FakeEvent())
        self.webview.window.native = types.SimpleNamespace(webview=control)
        with redirect_stdout(io.StringIO()), patch.object(sys, "argv", ["candidate.exe"]):
            self.module.main()
        self.assertEqual(len(self.webview.window.events.before_show.handlers), 1)
        self.webview.window.events.before_show.handlers[0]()
        control.CoreWebView2 = types.SimpleNamespace(Settings=core_settings)
        self.assertEqual(len(control.CoreWebView2InitializationCompleted.handlers), 1)
        control.CoreWebView2InitializationCompleted.handlers[0](control, types.SimpleNamespace(IsSuccess=True))
        self.assertFalse(core_settings.IsGeneralAutofillEnabled)
        self.assertTrue(core_settings.IsPasswordAutosaveEnabled)
        self.assertFalse(self.webview.start_kwargs["private_mode"])

    def test_client_disables_autofill_for_already_initialized_webview(self):
        settings = types.SimpleNamespace(IsGeneralAutofillEnabled=True)
        self.webview.window.native = types.SimpleNamespace(webview=types.SimpleNamespace(
            CoreWebView2=types.SimpleNamespace(Settings=settings), CoreWebView2InitializationCompleted=FakeEvent()
        ))
        with redirect_stdout(io.StringIO()), patch.object(sys, "argv", ["candidate.exe"]):
            self.module.main()
        self.assertEqual(len(self.webview.window.events.before_show.handlers), 1)
        self.webview.window.events.before_show.handlers[0]()
        self.assertFalse(settings.IsGeneralAutofillEnabled)

    def test_startup_flag_creates_hidden_window(self):
        with redirect_stdout(io.StringIO()), patch.object(
            sys, "argv", ["项目管理系统_桌面版.exe", "--startup-minimized"]
        ):
            self.module.main()

        self.assertIs(self.webview.create_kwargs["hidden"], True)

    def test_parallel_test_mode_bypasses_single_instance_mutex(self):
        self.module._acquire_single_instance = Mock(return_value=False)

        with redirect_stdout(io.StringIO()), patch.object(
            sys, "argv", ["customer-test.exe", "--startup-minimized"]
        ), patch.dict(os.environ, {"PROJECT_MGR_ALLOW_PARALLEL_TEST": "1"}):
            self.module.main()

        self.assertIsNotNone(self.webview.create_kwargs)
        self.module._acquire_single_instance.assert_not_called()
        self.module._release_single_instance.assert_not_called()

    def test_tray_failure_reveals_hidden_window(self):
        self.module._setup_tray = Mock(side_effect=RuntimeError("tray failed"))

        with redirect_stdout(io.StringIO()), patch.object(
            sys, "argv", ["项目管理系统_桌面版.exe", "--startup-minimized"]
        ):
            self.module.main()

        self.module._show_window.assert_called_once_with()
        self.module._log.assert_called_with("pystray setup failed: tray failed")

    def test_tray_failure_does_not_duplicate_normal_window_show(self):
        self.module._setup_tray = Mock(side_effect=RuntimeError("tray failed"))

        with redirect_stdout(io.StringIO()), patch.object(
            sys, "argv", ["项目管理系统_桌面版.exe"]
        ):
            self.module.main()

        self.module._show_window.assert_not_called()

    def test_scheduler_runs_jobs_independently_inside_application_context(self):
        self.assertTrue(callable(self.scheduler_loop))
        context_state = {"active": False}
        self.module._SHOULD_EXIT = False
        self.module.time = types.SimpleNamespace(
            sleep=lambda seconds: setattr(self.module, "_SHOULD_EXIT", True)
        )
        calls = []

        def scheduled_job(*, job):
            self.assertTrue(context_state["active"])
            calls.append(job)
            return self.temp_path / "daily.zip" if job == "backup" else None

        def failed_project_event_job():
            calls.append("project-event")
            raise RuntimeError("synthetic project event failure")

        def stage_completion_job():
            self.assertTrue(context_state["active"])
            calls.append("stage-completion")

        self.module.server_app = types.SimpleNamespace(
            app=types.SimpleNamespace(
                app_context=lambda: TrackingAppContext(context_state)
            ),
            _auto_advance_stages=stage_completion_job,
            run_scheduled_backup_if_due=scheduled_job,
            run_project_event_reminders_if_due=failed_project_event_job,
        )

        self.scheduler_loop()

        self.assertEqual(
            calls,
            ["backup", "digest", "project-event", "stage-completion"],
        )
        self.module._log.assert_any_call(
            f"Scheduled backup created: {self.temp_path / 'daily.zip'}"
        )
        self.module._log.assert_any_call(
            "Scheduler project-event error: SCHEDULED_JOB_FAILED"
        )

    def test_scheduler_logs_only_safe_error_codes_and_continues(self):
        self.assertTrue(callable(self.scheduler_loop))
        self.module._SHOULD_EXIT = False
        self.module.time = types.SimpleNamespace(
            sleep=lambda seconds: setattr(self.module, "_SHOULD_EXIT", True)
        )
        calls = []

        def scheduled_job(*, job):
            calls.append(job)
            if job == "digest":
                raise RuntimeError(
                    r"smtp.example.test rejected account@example.test at C:\secret\mail.txt"
                )

        self.module.server_app = types.SimpleNamespace(
            app=types.SimpleNamespace(
                app_context=lambda: TrackingAppContext({"active": False})
            ),
            run_scheduled_backup_if_due=scheduled_job,
            run_project_event_reminders_if_due=lambda: calls.append("project-event"),
            _auto_advance_stages=lambda: calls.append("stage-completion"),
        )

        self.scheduler_loop()

        self.assertEqual(calls, ["backup", "digest", "project-event", "stage-completion"])
        rendered_logs = "\n".join(str(call) for call in self.module._log.call_args_list)
        self.assertIn("Scheduler digest error: SCHEDULED_JOB_FAILED", rendered_logs)
        self.assertNotIn("smtp.example.test", rendered_logs)
        self.assertNotIn("account@example.test", rendered_logs)
        self.assertNotIn(r"C:\secret", rendered_logs)

    def test_scheduler_tolerates_missing_future_hooks(self):
        self.assertTrue(callable(self.scheduler_loop))
        self.module._SHOULD_EXIT = False
        self.module.time = types.SimpleNamespace(
            sleep=lambda seconds: setattr(self.module, "_SHOULD_EXIT", True)
        )
        scheduled = Mock(return_value=None)
        self.module.server_app = types.SimpleNamespace(
            app=types.SimpleNamespace(
                app_context=lambda: TrackingAppContext({"active": False})
            ),
            run_scheduled_backup_if_due=scheduled,
        )

        self.scheduler_loop()

        self.assertEqual(
            [call.kwargs for call in scheduled.call_args_list],
            [{"job": "backup"}, {"job": "digest"}],
        )

    def test_scheduler_backup_type_error_does_not_skip_remaining_jobs(self):
        self.assertTrue(callable(self.scheduler_loop))
        self.module._SHOULD_EXIT = False
        self.module.time = types.SimpleNamespace(
            sleep=lambda seconds: setattr(self.module, "_SHOULD_EXIT", True)
        )
        calls = []

        def scheduled_job(*, job):
            calls.append(job)
            if job == "backup":
                raise TypeError("synthetic backup implementation failure")

        self.module.server_app = types.SimpleNamespace(
            app=types.SimpleNamespace(
                app_context=lambda: TrackingAppContext({"active": False})
            ),
            run_scheduled_backup_if_due=scheduled_job,
            run_project_event_reminders_if_due=lambda: calls.append("project-event"),
            _auto_advance_stages=lambda: calls.append("stage-completion"),
        )

        self.scheduler_loop()

        self.assertEqual(calls, ["backup", "project-event", "stage-completion"])
        self.module._log.assert_any_call(
            "Scheduler backup error: SCHEDULED_JOB_FAILED"
        )

    def test_scheduler_calls_legacy_combined_backup_digest_hook_once(self):
        self.assertTrue(callable(self.scheduler_loop))
        self.module._SHOULD_EXIT = False
        self.module.time = types.SimpleNamespace(
            sleep=lambda seconds: setattr(self.module, "_SHOULD_EXIT", True)
        )
        calls = []

        def legacy_scheduler(now=None):
            calls.append(now)
            return self.temp_path / "legacy-daily.zip"

        self.module.server_app = types.SimpleNamespace(
            app=types.SimpleNamespace(
                app_context=lambda: TrackingAppContext({"active": False})
            ),
            run_scheduled_backup_if_due=legacy_scheduler,
        )

        self.scheduler_loop()

        self.assertEqual(calls, [None])
        self.module._log.assert_any_call(
            f"Scheduled backup created: {self.temp_path / 'legacy-daily.zip'}"
        )
        self.assertFalse(
            any("unexpected keyword argument" in str(call) for call in self.module._log.call_args_list)
        )


if __name__ == "__main__":
    unittest.main()
