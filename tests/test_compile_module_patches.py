import importlib.util
import inspect
import io
import marshal
import struct
import tempfile
import types
import unittest
import zlib
from contextlib import nullcontext, redirect_stdout
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "compile_module_patches.py"


def load_tool():
    if not MODULE_PATH.is_file():
        raise AssertionError(f"missing module patch compiler: {MODULE_PATH}")
    spec = importlib.util.spec_from_file_location("compile_module_patches_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def module_bytes(source, filename):
    return marshal.dumps(compile(source, filename, "exec"))


def build_pyz(entries):
    payload = bytearray(b"PYZ\0" + importlib.util.MAGIC_NUMBER + b"\0\0\0\0")
    toc = []
    for name, raw in entries:
        compressed = zlib.compress(raw, level=9)
        offset = len(payload)
        payload.extend(compressed)
        toc.append((name, (0, offset, len(compressed))))
    toc_offset = len(payload)
    payload.extend(marshal.dumps(toc))
    payload[8:12] = struct.pack("!i", toc_offset)
    return bytes(payload)


def parse_pyz(raw):
    if raw[:4] != b"PYZ\0":
        raise ValueError("invalid PYZ")
    toc_offset = struct.unpack("!i", raw[8:12])[0]
    toc = dict(marshal.loads(raw[toc_offset:]))
    entries = {}
    compressed = {}
    for name, (_, offset, length) in toc.items():
        value = raw[offset : offset + length]
        compressed[name] = value
        entries[name] = zlib.decompress(value)
    return entries, compressed


def pyz_toc_names(raw):
    toc_offset = struct.unpack("!i", raw[8:12])[0]
    return [name for name, _ in marshal.loads(raw[toc_offset:])]


def execute_module(raw):
    namespace = {}
    exec(marshal.loads(raw), namespace)
    return namespace


class CompileModulePatchTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp = Path(self.temp_dir.name)
        self.desktop_input = self.temp / "desktop_app.marshal"
        self.pyz_input = self.temp / "PYZ.pyz"
        self.app_replacements = self.temp / "app_replacements.py"
        self.desktop_replacements = self.temp / "desktop_replacements.py"
        self.purchaser_module = self.temp / "purchaser_classification.py"
        self.data_safety_module = self.temp / "data_safety.py"
        self.consortium_module = self.temp / "consortium_registration.py"
        self.project_activity_module = self.temp / "project_activity.py"
        self.data_import_module = self.temp / "data_import.py"
        self.signed_attachments_module = self.temp / "signed_attachments.py"
        self.device_admission_module = self.temp / "device_admission.py"
        self.device_keyring_module = self.temp / "device_keyring.py"
        self.device_access_page_module = self.temp / "device_access_page.py"
        self.http_security_module = self.temp / "http_security.py"
        self.data_recovery_module = self.temp / "data_recovery.py"
        self.data_security_replacements = self.temp / "data_security_replacements.py"
        self.lot_supplier_risk_module = self.temp / "lot_supplier_risk.py"
        self.desktop_output = self.temp / "desktop_app.patched.marshal"
        self.pyz_output = self.temp / "PYZ.patched.pyz"

        self.desktop_input.write_bytes(
            module_bytes(
                "def main():\n    return 'original-main'\n\n"
                "def _scheduler_loop():\n    return 'original-scheduler-loop'\n\n"
                "def desktop_untouched():\n    return 'desktop-unchanged'\n",
                "desktop_app.py",
            )
        )
        self.original_app_source = (
            "def login_required(function):\n"
            "    def original(*args, **kwargs):\n"
            "        return ('original-login', function(*args, **kwargs))\n"
            "    return original\n\n"
            "def api_get_settings():\n    return 'original-get'\n\n"
            "def api_update_settings():\n    return 'original-update'\n\n"
            "def api_system_info():\n    return {'version': 'v5.8.5'}\n\n"
            "def health():\n    return {'version': 'v5.8.5'}\n\n"
            "def unrelated_version():\n    return 'v5.8.5'\n\n"
            "MAX_FILE_SIZE = 200 * 1024 * 1024\n"
            "def attachment_upload_limit():\n    return MAX_FILE_SIZE\n\n"
            "def attachment_upload_error():\n    return 'demo.zip: 超过200MB限制'\n\n"
            "def run_scheduled_backup_if_due(now=None):\n"
            "    return 'original-reminder-scheduler'\n\n"
            "def run_project_event_reminders_if_due(now=None):\n"
            "    return 'original-project-event'\n\n"
            "def _auto_advance_stages():\n    return 'original-auto-completion'\n\n"
            "def api_export():\n    import openpyxl\n    return 'original-export'\n\n"
            "class Unrelated:\n"
            "    def to_dict(self):\n        return {'unrelated': True}\n\n"
            "class SupplierRegistration:\n"
            "    def to_dict(self):\n"
            "        registration_method = self.registration_method\n"
            "        attachments = self.attachments\n"
            "        company_name = self.company_name\n"
            "        return {'registration_method': registration_method, 'attachments': attachments, 'company_name': company_name}\n\n"
            "def api_get_registrations(pid):\n    return ('original-get-registrations', pid)\n\n"
            "def api_create_registration(pid):\n    return ('original-create-registration', pid)\n\n"
            "def api_update_registration(pid, rid):\n    return ('original-update-registration', pid, rid)\n\n"
            "def api_delete_registration(pid, rid):\n    return ('original-delete-registration', pid, rid)\n"
        )
        app_raw = module_bytes(
            self.original_app_source,
            "app.py",
        )
        untouched_raw = module_bytes(
            "def untouched():\n    return 'pyz-unchanged'\n",
            "untouched.py",
        )
        preserved_raw = module_bytes(
            "def preserved():\n    return 'second-pyz-unchanged'\n",
            "preserved.py",
        )
        self.pyz_input.write_bytes(
            build_pyz(
                [
                    ("app", app_raw),
                    ("data_security", module_bytes(
                        "def load_or_create_master_key(data_dir, require_recovery=False, existing_encrypted=False):\n"
                        "    return ('original-key', None)\n",
                        "data_security.py",
                    )),
                    ("untouched", untouched_raw),
                    ("preserved", preserved_raw),
                ]
            )
        )
        self.app_replacements.write_text(
            "def login_required(function):\n"
            "    marker = 'project activity audit failed'\n"
            "    def decorated(*args, **kwargs):\n"
            "        return ('patched-login', function(*args, **kwargs))\n"
            "    return decorated\n\n"
            "def api_get_settings():\n    return 'patched-get'\n\n"
            "def api_update_settings():\n    return 'patched-update'\n\n"
            "def run_scheduled_backup_if_due(now=None, job='backup'):\n"
            "    import smtplib\n"
            "    markers = ('reminder_send_log.json', 'registration_end', 'bid_opening', 'CryptUnprotectData')\n"
            "    globals().setdefault('scheduled_jobs', []).append(job)\n"
            "    if job in globals().get('scheduled_failures', set()):\n"
            "        raise RuntimeError(f'{job}-failed')\n"
            "    return 'patched-reminder-scheduler' if job == 'backup' else None\n\n"
            "def run_project_event_reminders_if_due(now=None):\n"
            "    markers = ('project_events_state.json', 'pending_events', 'create|', 'complete|')\n"
            "    return 'patched-project-event'\n\n"
            "def _auto_advance_stages():\n"
            "    markers = ('stage_auto_completion_state.json', 'stage_auto_completion_log.jsonl', 'stage_auto_completion_audit', 'auto_complete_stage', 'auto_completion', 'auto_completion_policies')\n"
            "    return 'patched-auto-completion'\n\n"
            "def api_export():\n"
            "    xlsx_filename = 'ProjectList_'\n"
            "    content_types = '[Content_Types].xml'\n"
            "    return 'patched-export'\n\n"
            "def supplier_registration_to_dict(self):\n"
            "    markers = ('bidder_type', 'consortium_members', 'registration_consortium_members')\n"
            "    return {'patched-registration': self.company_name}\n\n"
            "def api_get_registrations(pid):\n    return ('patched-get-registrations', pid)\n\n"
            "def api_create_registration(pid):\n    return ('patched-create-registration', pid)\n\n"
            "def api_update_registration(pid, rid):\n    return ('patched-update-registration', pid, rid)\n\n"
            "def api_delete_registration(pid, rid):\n    return ('patched-delete-registration', pid, rid)\n",
            encoding="utf-8",
        )
        self.desktop_replacements.write_text(
            "def _scheduler_loop():\n"
            "    jobs = ('run_scheduled_backup_if_due', 'run_project_event_reminders_if_due', 'run_stage_completion_reminders_if_due')\n"
            "    return 'patched-scheduler-loop'\n\n"
            "def main():\n    marker = '--startup-minimized'\n"
            "    hidden = True\n    return 'patched-main'\n",
            encoding="utf-8",
        )
        self.purchaser_module.write_text(
            "def marker():\n    return 'purchaser-classification'\n",
            encoding="utf-8",
        )
        self.data_safety_module.write_text(
            "def marker():\n    return 'data-safety'\n",
            encoding="utf-8",
        )
        self.consortium_module.write_text(
            "def marker():\n    return 'registration_consortium_members'\n",
            encoding="utf-8",
        )
        self.project_activity_module.write_text(
            "def marker():\n    return 'project-activity-audit'\n",
            encoding="utf-8",
        )
        self.data_import_module.write_text(
            "def marker():\n    return 'data-import'\n",
            encoding="utf-8",
        )
        self.signed_attachments_module.write_text(
            '"""signed-attachments-v1"""\n\n'
            "def marker():\n    return 'signed-attachments'\n",
            encoding="utf-8",
        )
        self.device_admission_module.write_text(
            '"""Browser-token device admission for the frozen V5 application."""\n'
            "def marker():\n    return 'device-admission'\n",
            encoding="utf-8",
        )
        self.device_keyring_module.write_text(
            '"""Portable encrypted keyring for V5 device admission migration."""\n'
            "def marker():\n    return 'device-keyring'\n",
            encoding="utf-8",
        )
        self.device_access_page_module.write_text(
            '"""Minimal anonymous device-access request page for the frozen V5 application."""\n'
            "def marker():\n    return 'device-access-page'\n",
            encoding="utf-8",
        )
        self.http_security_module.write_text(
            '"""HTTP response and access-log hardening for the frozen V5 application."""\n'
            "def marker():\n    return 'http-security'\n",
            encoding="utf-8",
        )
        self.data_recovery_module.write_text(
            '"""Local-only recovery-key binding for the frozen V5 application."""\n'
            "def marker():\n    return 'data-recovery'\n",
            encoding="utf-8",
        )
        self.data_security_replacements.write_text(
            "def load_or_create_master_key(data_dir, require_recovery=False, existing_encrypted=False):\n"
            "    marker = 'v5-interactive-recovery-v1'\n"
            "    return ('patched-key', None)\n",
            encoding="utf-8",
        )
        self.lot_supplier_risk_module.write_text(
            '"""Lot-level supplier shortage rules, state, audit, and retender helpers."""\n'
            "def marker():\n    return 'lot-supplier-risk'\n",
            encoding="utf-8",
        )
        self.tool = load_tool()

    def tearDown(self):
        self.temp_dir.cleanup()

    def compile(self):
        self.tool.compile_patches(
            desktop_input=self.desktop_input,
            pyz_input=self.pyz_input,
            app_replacements=self.app_replacements,
            desktop_replacements=self.desktop_replacements,
            purchaser_module=self.purchaser_module,
            data_safety_module=self.data_safety_module,
            consortium_module=self.consortium_module,
            project_activity_module=self.project_activity_module,
            data_import_module=self.data_import_module,
            signed_attachments_module=self.signed_attachments_module,
            device_admission_module=self.device_admission_module,
            device_keyring_module=self.device_keyring_module,
            device_access_page_module=self.device_access_page_module,
            http_security_module=self.http_security_module,
            data_recovery_module=self.data_recovery_module,
            data_security_replacements=self.data_security_replacements,
            lot_supplier_risk_module=self.lot_supplier_risk_module,
            desktop_output=self.desktop_output,
            pyz_output=self.pyz_output,
        )

    def replace_app_source(self, source):
        entries, _ = parse_pyz(self.pyz_input.read_bytes())
        entries["app"] = module_bytes(source, "app.py")
        self.pyz_input.write_bytes(build_pyz(list(entries.items())))

    @staticmethod
    def registration_replacement_source():
        return (
            "\ndef login_required(function):\n"
            "    marker = 'project activity audit failed'\n"
            "    return function\n\n"
            "def supplier_registration_to_dict(self):\n"
            "    markers = ('bidder_type', 'consortium_members', 'registration_consortium_members')\n"
            "    return {'patched-registration': self.company_name}\n\n"
            "def api_get_registrations(pid):\n    return ('patched-get-registrations', pid)\n\n"
            "def api_create_registration(pid):\n    return ('patched-create-registration', pid)\n\n"
            "def api_update_registration(pid, rid):\n    return ('patched-update-registration', pid, rid)\n\n"
            "def api_delete_registration(pid, rid):\n    return ('patched-delete-registration', pid, rid)\n"
        )

    def test_replaces_targets_and_preserves_other_payloads(self):
        _, original_compressed = parse_pyz(self.pyz_input.read_bytes())

        self.compile()

        desktop = execute_module(self.desktop_output.read_bytes())
        entries, patched_compressed = parse_pyz(self.pyz_output.read_bytes())
        app = execute_module(entries["app"])
        untouched = execute_module(entries["untouched"])
        preserved = execute_module(entries["preserved"])
        self.assertEqual(desktop["main"](), "patched-main")
        self.assertEqual(desktop["_scheduler_loop"](), "patched-scheduler-loop")
        self.assertEqual(desktop["desktop_untouched"](), "desktop-unchanged")
        self.assertEqual(app["api_get_settings"](), "patched-get")
        self.assertEqual(
            app["login_required"](lambda: "ok")(),
            ("patched-login", "ok"),
        )
        self.assertEqual(app["api_update_settings"](), "patched-update")
        self.assertEqual(app["attachment_upload_limit"](), 1073741824)
        self.assertEqual(
            app["attachment_upload_error"](),
            "demo.zip: 超过1GB限制",
        )
        self.assertEqual(app["run_scheduled_backup_if_due"](), "patched-reminder-scheduler")
        self.assertEqual(app["scheduled_jobs"], ["backup", "digest"])
        self.assertEqual(
            app["run_project_event_reminders_if_due"](), "patched-project-event"
        )
        self.assertEqual(app["_auto_advance_stages"](), "patched-auto-completion")
        self.assertEqual(app["api_export"](), "patched-export")
        registration = app["SupplierRegistration"]()
        registration.company_name = "牵头单位"
        self.assertEqual(
            registration.to_dict(), {"patched-registration": "牵头单位"}
        )
        self.assertEqual(app["Unrelated"]().to_dict(), {"unrelated": True})
        self.assertEqual(
            app["api_get_registrations"](7), ("patched-get-registrations", 7)
        )
        self.assertEqual(
            app["api_create_registration"](7), ("patched-create-registration", 7)
        )
        self.assertEqual(
            app["api_update_registration"](7, 8),
            ("patched-update-registration", 7, 8),
        )
        self.assertEqual(
            app["api_delete_registration"](7, 8),
            ("patched-delete-registration", 7, 8),
        )
        self.assertEqual(
            execute_module(entries["consortium_registration"])["marker"](),
            "registration_consortium_members",
        )
        self.assertEqual(
            execute_module(entries["signed_attachments"])["marker"](),
            "signed-attachments",
        )
        routing = execute_module(entries["reminder_routing"])
        self.assertEqual(
            routing["EVENT_TYPES"],
            ("daily_stage", "project_create", "project_complete", "supplier_shortage"),
        )
        self.assertTrue(callable(routing["route_reminder_event"]))
        self.assertEqual(untouched["untouched"](), "pyz-unchanged")
        self.assertEqual(preserved["preserved"](), "second-pyz-unchanged")
        for name in ("untouched", "preserved"):
            with self.subTest(name=name):
                self.assertEqual(
                    original_compressed[name],
                    patched_compressed[name],
                )

    def test_replaces_create_project_when_the_packaged_target_exists(self):
        self.replace_app_source(
            self.original_app_source
            + "\ndef api_create_project():\n    return 'original-create-project'\n"
        )
        self.app_replacements.write_text(
            self.app_replacements.read_text(encoding="utf-8")
            + "\ndef api_create_project():\n    return 'patched-create-project'\n",
            encoding="utf-8",
        )

        self.compile()

        entries, _ = parse_pyz(self.pyz_output.read_bytes())
        self.assertEqual(
            execute_module(entries["app"])["api_create_project"](),
            "patched-create-project",
        )

    def test_legacy_reminder_wrapper_runs_backup_and_digest_with_isolated_failures(self):
        self.compile()

        entries, _ = parse_pyz(self.pyz_output.read_bytes())
        app = execute_module(entries["app"])
        scheduler = app["run_scheduled_backup_if_due"]
        self.assertEqual(str(inspect.signature(scheduler)), "(now=None)")

        app["scheduled_jobs"] = []
        app["scheduled_failures"] = {"backup"}
        with redirect_stdout(io.StringIO()):
            self.assertIsNone(scheduler())
        self.assertEqual(app["scheduled_jobs"], ["backup", "digest"])

        app["scheduled_jobs"] = []
        app["scheduled_failures"] = {"digest"}
        with redirect_stdout(io.StringIO()):
            self.assertEqual(scheduler(), "patched-reminder-scheduler")
        self.assertEqual(app["scheduled_jobs"], ["backup", "digest"])

        with self.assertRaises(TypeError):
            scheduler(job="digest")

    def test_compile_adds_the_single_known_missing_project_event_target(self):
        missing_event_source = self.original_app_source.replace(
            "def run_project_event_reminders_if_due(now=None):\n"
            "    return 'original-project-event'\n\n",
            "",
        )
        self.replace_app_source(missing_event_source)
        self.app_replacements.write_text(
            self.app_replacements.read_text(encoding="utf-8").replace(
                "    return 'patched-project-event'\n\n"
                "def _auto_advance_stages():\n"
                "    markers = ('stage_auto_completion_state.json', 'stage_auto_completion_log.jsonl', 'stage_auto_completion_audit', 'auto_complete_stage', 'auto_completion', 'auto_completion_policies')\n"
                "    return 'patched-auto-completion'\n",
                "    globals()['project_event_calls'] = "
                "globals().get('project_event_calls', 0) + 1\n"
                "    if globals().get('project_event_failure'):\n"
                "        raise RuntimeError('project-event-failed')\n"
                "    return 'patched-project-event'\n\n"
                "def _auto_advance_stages():\n"
                "    markers = ('stage_auto_completion_state.json', 'stage_auto_completion_log.jsonl', 'stage_auto_completion_audit', 'auto_complete_stage', 'auto_completion', 'auto_completion_policies')\n"
                "    globals()['stage_calls'] = globals().get('stage_calls', 0) + 1\n"
                "    return 'patched-auto-completion'\n",
            ),
            encoding="utf-8",
        )

        self.compile()

        entries, _ = parse_pyz(self.pyz_output.read_bytes())
        app_root = marshal.loads(entries["app"])
        desktop_root = marshal.loads(self.desktop_output.read_bytes())
        app = execute_module(entries["app"])
        app["app"] = types.SimpleNamespace(
            app_context=nullcontext
        )
        app["project_event_failure"] = True
        with redirect_stdout(io.StringIO()):
            self.assertEqual(app["_auto_advance_stages"](), "patched-auto-completion")
        self.assertEqual(app["project_event_calls"], 1)
        self.assertEqual(app["stage_calls"], 1)
        self.assertNotIn("scheduled_jobs", app)
        self.assertEqual(
            len(self.tool._named_code_objects(app_root, "run_project_event_reminders_if_due"))
            + len(
                self.tool._named_code_objects(
                    desktop_root,
                    "run_project_event_reminders_if_due",
                )
            ),
            1,
        )

    def test_recompiling_an_injected_project_event_target_preserves_it(self):
        nested_event_source = self.original_app_source.replace(
            "def run_project_event_reminders_if_due(now=None):\n"
            "    return 'original-project-event'\n\n",
            "",
        ).replace(
            "def _auto_advance_stages():\n    return 'original-auto-completion'\n\n",
            "def _auto_advance_stages():\n"
            "    def run_project_event_reminders_if_due(now=None):\n"
            "        return 'original-project-event'\n"
            "    return 'original-auto-completion'\n\n",
        )
        self.replace_app_source(nested_event_source)
        self.compile()

        entries, _ = parse_pyz(self.pyz_output.read_bytes())
        app_root = marshal.loads(entries["app"])
        desktop_root = marshal.loads(self.desktop_output.read_bytes())
        self.assertEqual(
            len(self.tool._named_code_objects(app_root, "run_project_event_reminders_if_due"))
            + len(
                self.tool._named_code_objects(
                    desktop_root,
                    "run_project_event_reminders_if_due",
                )
            ),
            1,
        )

    def test_compile_replaces_only_the_exact_backend_version_targets(self):
        self.compile()

        entries, _ = parse_pyz(self.pyz_output.read_bytes())
        app = execute_module(entries["app"])
        self.assertEqual(app["api_system_info"](), {"version": "v5.8.13"})
        self.assertEqual(app["health"](), {"version": "v5.8.13"})
        self.assertEqual(app["unrelated_version"](), "v5.8.5")

    def test_embeds_smtplib_required_by_reminder_runtime(self):
        self.compile()

        entries, _ = parse_pyz(self.pyz_output.read_bytes())

        self.assertIn("smtplib", entries)
        self.assertIsInstance(marshal.loads(entries["smtplib"]), types.CodeType)

    def test_formal_upload_limit_login_wrapper_is_preserved(self):
        original_module = compile(
            "def login_required(function):\n"
            "    import upload_limit_settings\n"
            "    upload_limit_settings.install_upload_limit_settings(app, globals(), login_required)\n"
            "    return function\n",
            "<formal-login>",
            "exec",
        )
        replacement_module = compile(
            "def login_required(function):\n    return function\n",
            "<replacement-login>",
            "exec",
        )
        original = self.tool._named_code_objects(original_module, "login_required")[0]
        replacement = self.tool._named_code_objects(replacement_module, "login_required")[0]
        selector = getattr(self.tool, "preserve_upload_limit_login_wrapper", None)
        if selector is None:
            self.fail("compiler does not preserve the formal upload-limit wrapper")

        selected = selector(original, replacement)

        self.assertIn("install_upload_limit_settings", self.tool._code_markers(selected))

    def test_compile_patches_packages_each_safety_module_exactly_once(self):
        self.compile()

        raw = self.pyz_output.read_bytes()
        entries, _ = parse_pyz(raw)
        purchaser = execute_module(entries["purchaser_classification"])
        data_safety = execute_module(entries["data_safety"])
        self.assertEqual(purchaser["marker"](), "purchaser-classification")
        self.assertEqual(data_safety["marker"](), "data-safety")
        self.assertEqual(pyz_toc_names(raw).count("purchaser_classification"), 1)
        self.assertEqual(pyz_toc_names(raw).count("data_safety"), 1)
        self.assertEqual(pyz_toc_names(raw).count("project_activity"), 1)
        self.assertEqual(pyz_toc_names(raw).count("signed_attachments"), 1)
        self.assertEqual(pyz_toc_names(raw).count("lot_supplier_risk"), 1)
        self.assertEqual(pyz_toc_names(raw).count("stage_workflow"), 1)
        self.assertEqual(pyz_toc_names(raw).count("stage_templates"), 1)
        self.assertEqual(pyz_toc_names(raw).count("device_admission"), 1)
        self.assertEqual(pyz_toc_names(raw).count("device_keyring"), 1)
        self.assertEqual(pyz_toc_names(raw).count("device_access_page"), 1)
        self.assertEqual(pyz_toc_names(raw).count("http_security"), 1)
        self.assertEqual(pyz_toc_names(raw).count("data_recovery"), 1)
        self.assertEqual(pyz_toc_names(raw).count("data_security"), 1)
        self.assertIn(
            "stage-workflow-order-v1",
            execute_module(entries["stage_workflow"])["__doc__"],
        )
        self.assertIn(
            "procurement-stage-templates-v1",
            execute_module(entries["stage_templates"])["__doc__"],
        )
        self.assertIn(
            "Browser-token device admission",
            execute_module(entries["device_admission"])["__doc__"],
        )
        self.assertIn(
            "Portable encrypted keyring",
            execute_module(entries["device_keyring"])["__doc__"],
        )
        self.assertIn(
            "Minimal anonymous device-access request page",
            execute_module(entries["device_access_page"])["__doc__"],
        )
        self.assertIn(
            "HTTP response and access-log hardening",
            execute_module(entries["http_security"])["__doc__"],
        )
        self.assertIn(
            "Local-only recovery-key binding",
            execute_module(entries["data_recovery"])["__doc__"],
        )
        data_security_root = marshal.loads(entries["data_security"])
        patched_loader = self.tool._named_code_objects(
            data_security_root, "load_or_create_master_key"
        )
        self.assertEqual(len(patched_loader), 1)
        self.assertIn(
            "v5-interactive-recovery-v1",
            self.tool._code_markers(patched_loader[0]),
        )
        self.assertNotIn("customer_management", entries)

    def test_compile_rejects_uncontrolled_device_security_module_collisions(self):
        original = self.pyz_input.read_bytes()
        for module_name in ("device_admission", "device_keyring", "device_access_page", "http_security"):
            with self.subTest(module_name=module_name):
                self.pyz_input.write_bytes(original)
                self.desktop_output.unlink(missing_ok=True)
                self.pyz_output.unlink(missing_ok=True)
                entries, _ = parse_pyz(self.pyz_input.read_bytes())
                entries[module_name] = module_bytes(
                    '"""unknown security helper"""\n',
                    f"{module_name}.py",
                )
                self.pyz_input.write_bytes(build_pyz(list(entries.items())))

                with self.assertRaisesRegex(ValueError, "uncontrolled PYZ module"):
                    self.compile()

                self.assertFalse(self.desktop_output.exists())
                self.assertFalse(self.pyz_output.exists())

    def test_compile_replaces_known_device_security_modules_exactly_once(self):
        entries, _ = parse_pyz(self.pyz_input.read_bytes())
        signatures = {
            "device_admission": "Browser-token device admission for the frozen V5 application.",
            "device_keyring": "Portable encrypted keyring for V5 device admission migration.",
            "device_access_page": "Minimal anonymous device-access request page for the frozen V5 application.",
            "http_security": "HTTP response and access-log hardening for the frozen V5 application.",
        }
        for module_name, signature in signatures.items():
            entries[module_name] = module_bytes(
                f'"""{signature}"""\ndef marker():\n    return "old"\n',
                f"{module_name}.py",
            )
        self.pyz_input.write_bytes(build_pyz(list(entries.items())))

        self.compile()

        raw = self.pyz_output.read_bytes()
        patched, _ = parse_pyz(raw)
        for module_name in signatures:
            with self.subTest(module_name=module_name):
                self.assertEqual(pyz_toc_names(raw).count(module_name), 1)
                self.assertNotEqual(execute_module(patched[module_name])["marker"](), "old")

    def test_compile_rejects_an_uncontrolled_stage_workflow_collision(self):
        entries, _ = parse_pyz(self.pyz_input.read_bytes())
        entries["stage_workflow"] = module_bytes(
            '"""unknown stage helper"""\n',
            "stage_workflow.py",
        )
        self.pyz_input.write_bytes(build_pyz(list(entries.items())))

        with self.assertRaisesRegex(ValueError, "already exists"):
            self.compile()

        self.assertFalse(self.desktop_output.exists())
        self.assertFalse(self.pyz_output.exists())

    def test_compile_replaces_the_known_packaged_purchaser_module_once(self):
        entries, _ = parse_pyz(self.pyz_input.read_bytes())
        entries["purchaser_classification"] = module_bytes(
            "def marker():\n    return 'formal-glm-version'\n",
            "purchaser_classification.py",
        )
        self.pyz_input.write_bytes(build_pyz(list(entries.items())))

        self.compile()

        raw = self.pyz_output.read_bytes()
        patched, _ = parse_pyz(raw)
        self.assertEqual(
            execute_module(patched["purchaser_classification"])["marker"](),
            "purchaser-classification",
        )
        self.assertEqual(pyz_toc_names(raw).count("purchaser_classification"), 1)

    def test_compile_rejects_duplicate_packaged_purchaser_modules(self):
        entries, _ = parse_pyz(self.pyz_input.read_bytes())
        existing = module_bytes("value = 1\n", "purchaser_classification.py")
        duplicated = list(entries.items()) + [
            ("purchaser_classification", existing),
            ("purchaser_classification", existing),
        ]
        self.pyz_input.write_bytes(build_pyz(duplicated))

        with self.assertRaisesRegex(ValueError, "duplicate PYZ TOC names"):
            self.compile()

        self.assertFalse(self.desktop_output.exists())
        self.assertFalse(self.pyz_output.exists())

    def test_compile_rejects_all_duplicate_toc_names_before_dict_conversion(self):
        entries, _ = parse_pyz(self.pyz_input.read_bytes())
        original = list(entries.items())
        smtplib = module_bytes("value = 'smtp'\n", "smtplib.py")
        mystery = module_bytes("value = 'unknown'\n", "mystery.py")
        duplicate_cases = {
            "app": original + [("app", entries["app"])],
            "smtplib": original + [("smtplib", smtplib), ("smtplib", smtplib)],
            "mystery": original + [("mystery", mystery), ("mystery", mystery)],
        }

        for name, duplicated in duplicate_cases.items():
            with self.subTest(name=name):
                self.pyz_input.write_bytes(build_pyz(duplicated))
                with self.assertRaisesRegex(
                    ValueError,
                    rf"duplicate PYZ TOC names.*{name}",
                ):
                    self.compile()
                self.assertFalse(self.desktop_output.exists())
                self.assertFalse(self.pyz_output.exists())

    def test_compile_rejects_an_uncontrolled_data_safety_collision_atomically(self):
        entries, _ = parse_pyz(self.pyz_input.read_bytes())
        entries["data_safety"] = module_bytes(
            "def marker():\n    return 'unknown-existing-version'\n",
            "data_safety.py",
        )
        self.pyz_input.write_bytes(build_pyz(list(entries.items())))

        with self.assertRaisesRegex(ValueError, "already exists"):
            self.compile()

        self.assertFalse(self.desktop_output.exists())
        self.assertFalse(self.pyz_output.exists())

    def test_compile_replaces_existing_controlled_safety_modules(self):
        # 正式 EXE（>= v5.8.8）已携带旧版受控补丁模块：同名单条目不拒绝，
        # 而是校验模块 docstring 签名后替换为新版（v5.8.12 安全修复）。
        entries, _ = parse_pyz(self.pyz_input.read_bytes())
        entries["data_safety"] = module_bytes(
            '"""Verified, additive-only SQLite migrations for the packaged application."""\n\n'
            "def marker():\n    return 'legacy-data-safety'\n",
            "data_safety.py",
        )
        entries["consortium_registration"] = module_bytes(
            '"""Structured consortium storage helpers for the frozen application patch."""\n\n'
            "def marker():\n    return 'legacy-consortium'\n",
            "consortium_registration.py",
        )
        entries["project_activity"] = module_bytes(
            '"""Project-scoped activity classification, sanitization, persistence, and reads."""\n\n'
            "def marker():\n    return 'legacy-project-activity'\n",
            "project_activity.py",
        )
        self.pyz_input.write_bytes(build_pyz(list(entries.items())))

        self.compile()

        raw = self.pyz_output.read_bytes()
        patched, _ = parse_pyz(raw)
        self.assertEqual(
            execute_module(patched["data_safety"])["marker"](), "data-safety"
        )
        self.assertEqual(
            execute_module(patched["consortium_registration"])["marker"](),
            "registration_consortium_members",
        )
        self.assertEqual(
            execute_module(patched["project_activity"])["marker"](),
            "project-activity-audit",
        )
        self.assertEqual(pyz_toc_names(raw).count("data_safety"), 1)
        self.assertEqual(pyz_toc_names(raw).count("consortium_registration"), 1)
        self.assertEqual(pyz_toc_names(raw).count("project_activity"), 1)

    def test_missing_target_code_object_is_rejected(self):
        self.desktop_input.write_bytes(
            module_bytes("def other():\n    return 1\n", "desktop_app.py")
        )

        with self.assertRaises(KeyError):
            self.compile()

    def test_duplicate_target_code_object_is_rejected(self):
        self.desktop_input.write_bytes(
            module_bytes(
                "def _scheduler_loop():\n    return 0\n\n"
                "def main():\n    return 1\n\n"
                "class Duplicate:\n    def main(self):\n        return 2\n",
                "desktop_app.py",
            )
        )

        with self.assertRaises(ValueError):
            self.compile()

    def test_invalid_pyz_header_is_rejected(self):
        self.pyz_input.write_bytes(b"not-a-pyz")

        with self.assertRaises(ValueError):
            self.compile()

    def test_rebuild_pyz_adds_importable_purchaser_module(self):
        original = self.pyz_input.read_bytes()
        app_raw = parse_pyz(original)[0]["app"]
        purchaser_raw = self.tool.compile_source_module(self.purchaser_module)

        rebuilt = self.tool._rebuild_pyz(
            original,
            "app",
            app_raw,
            {"purchaser_classification": purchaser_raw},
        )

        entries, _ = parse_pyz(rebuilt)
        purchaser = execute_module(entries["purchaser_classification"])
        self.assertEqual(purchaser["marker"](), "purchaser-classification")

    def test_rebuild_pyz_rejects_addition_name_collision(self):
        original = self.pyz_input.read_bytes()
        app_raw = parse_pyz(original)[0]["app"]
        purchaser_raw = self.tool.compile_source_module(self.purchaser_module)

        with self.assertRaisesRegex(ValueError, "already exists"):
            self.tool._rebuild_pyz(
                original,
                "app",
                app_raw,
                {"untouched": purchaser_raw},
            )

    def test_rebuild_pyz_rejects_either_safety_module_addition_collision(self):
        app_raw = parse_pyz(self.pyz_input.read_bytes())[0]["app"]
        purchaser_raw = self.tool.compile_source_module(self.purchaser_module)
        data_safety_raw = self.tool.compile_source_module(self.data_safety_module)
        for name, addition_raw in (
            ("purchaser_classification", purchaser_raw),
            ("data_safety", data_safety_raw),
        ):
            with self.subTest(name=name):
                original = build_pyz(
                    [("app", app_raw), (name, module_bytes("value = 1\n", f"{name}.py"))]
                )
                with self.assertRaisesRegex(ValueError, "already exists"):
                    self.tool._rebuild_pyz(
                        original,
                        "app",
                        app_raw,
                        {name: addition_raw},
                    )

    def test_version_guard_rejects_non_312_runtime(self):
        with self.assertRaises(RuntimeError):
            self.tool.require_python312((3, 11))

    def test_verify_accepts_compiled_outputs(self):
        self.compile()

        self.tool.verify_patches(
            self.desktop_output,
            self.pyz_output,
            app_markers=("patched-get", "patched-update"),
            desktop_markers=("--startup-minimized",),
        )

    def test_verify_rejects_auto_completion_without_transactional_audit(self):
        source = self.app_replacements.read_text(encoding="utf-8").replace(
            "'stage_auto_completion_audit', ", ""
        )
        self.app_replacements.write_text(source, encoding="utf-8")
        self.compile()

        with self.assertRaisesRegex(ValueError, "stage_auto_completion_audit"):
            self.tool.verify_patches(
                self.desktop_output,
                self.pyz_output,
                app_markers=("patched-get", "patched-update"),
                desktop_markers=("--startup-minimized",),
            )

    def test_verify_rejects_customer_management_even_with_both_safety_modules(self):
        self.compile()
        entries, _ = parse_pyz(self.pyz_output.read_bytes())
        entries["customer_management"] = module_bytes("value = 1\n", "customer_management.py")
        self.pyz_output.write_bytes(build_pyz(list(entries.items())))

        with self.assertRaisesRegex(ValueError, "customer_module=True"):
            self.tool.verify_patches(
                self.desktop_output,
                self.pyz_output,
                app_markers=("patched-get", "patched-update"),
                desktop_markers=("--startup-minimized",),
            )

    def test_verify_rejects_duplicate_safety_module_toc_names(self):
        self.compile()
        entries, _ = parse_pyz(self.pyz_output.read_bytes())
        duplicated = list(entries.items()) + [("data_safety", entries["data_safety"])]
        self.pyz_output.write_bytes(build_pyz(duplicated))

        with self.assertRaisesRegex(ValueError, "duplicate PYZ TOC names"):
            self.tool.verify_patches(
                self.desktop_output,
                self.pyz_output,
                app_markers=("patched-get", "patched-update"),
                desktop_markers=("--startup-minimized",),
            )

    def test_verify_defaults_require_purchaser_dispatch_markers(self):
        markers = self.tool.verify_patches.__kwdefaults__["app_markers"]

        self.assertIn("purchaser_board_view", markers)
        self.assertIn("purchaser_board_action", markers)
        self.assertIn("purchaser_classification", markers)
        self.assertIn("project_activity_view", markers)
        self.assertIn("project activity audit failed", markers)
        self.assertNotIn("customer_management", markers)

    def test_verify_rejects_api_export_without_xlsx_markers(self):
        self.app_replacements.write_text(
            "def api_get_settings():\n    return 'patched-get'\n\n"
            "def api_update_settings():\n    return 'patched-update'\n\n"
            "def run_scheduled_backup_if_due(now=None):\n"
            "    import smtplib\n"
            "    markers = ('reminder_send_log.json', 'registration_end', 'bid_opening', 'CryptUnprotectData')\n"
            "    return 'patched-reminder-scheduler'\n\n"
            "def run_project_event_reminders_if_due(now=None):\n"
            "    markers = ('project_events_state.json', 'pending_events', 'create|', 'complete|')\n"
            "    return 'patched-project-event'\n\n"
            "def _auto_advance_stages():\n"
            "    markers = ('stage_auto_completion_state.json', 'stage_auto_completion_log.jsonl', 'stage_auto_completion_audit', 'auto_complete_stage', 'auto_completion', 'auto_completion_policies')\n"
            "    return 'patched-auto-completion'\n\n"
            "def api_export():\n    return 'patched-export'\n"
            + self.registration_replacement_source(),
            encoding="utf-8",
        )
        self.compile()

        with self.assertRaisesRegex(ValueError, "api_export"):
            self.tool.verify_patches(
                self.desktop_output,
                self.pyz_output,
                app_markers=("patched-get", "patched-update"),
                desktop_markers=("--startup-minimized",),
            )

    def test_verify_rejects_direct_openpyxl_with_xlsx_markers(self):
        self.app_replacements.write_text(
            "def api_get_settings():\n    return 'patched-get'\n\n"
            "def api_update_settings():\n    return 'patched-update'\n\n"
            "def run_scheduled_backup_if_due(now=None):\n"
            "    import smtplib\n"
            "    markers = ('reminder_send_log.json', 'registration_end', 'bid_opening', 'CryptUnprotectData')\n"
            "    return 'patched-reminder-scheduler'\n\n"
            "def run_project_event_reminders_if_due(now=None):\n"
            "    markers = ('project_events_state.json', 'pending_events', 'create|', 'complete|')\n"
            "    return 'patched-project-event'\n\n"
            "def _auto_advance_stages():\n"
            "    markers = ('stage_auto_completion_state.json', 'stage_auto_completion_log.jsonl', 'stage_auto_completion_audit', 'auto_complete_stage', 'auto_completion', 'auto_completion_policies')\n"
            "    return 'patched-auto-completion'\n\n"
            "def api_export():\n"
            "    import openpyxl\n"
            "    xlsx_filename = 'ProjectList_'\n"
            "    content_types = '[Content_Types].xml'\n"
            "    return 'patched-export'\n"
            + self.registration_replacement_source(),
            encoding="utf-8",
        )
        self.compile()

        with self.assertRaisesRegex(ValueError, "api_export_openpyxl=True"):
            self.tool.verify_patches(
                self.desktop_output,
                self.pyz_output,
                app_markers=("patched-get", "patched-update"),
                desktop_markers=("--startup-minimized",),
            )

    def test_verify_rejects_nested_openpyxl_with_xlsx_markers(self):
        self.app_replacements.write_text(
            "def api_get_settings():\n    return 'patched-get'\n\n"
            "def api_update_settings():\n    return 'patched-update'\n\n"
            "def run_scheduled_backup_if_due(now=None):\n"
            "    import smtplib\n"
            "    markers = ('reminder_send_log.json', 'registration_end', 'bid_opening', 'CryptUnprotectData')\n"
            "    return 'patched-reminder-scheduler'\n\n"
            "def run_project_event_reminders_if_due(now=None):\n"
            "    markers = ('project_events_state.json', 'pending_events', 'create|', 'complete|')\n"
            "    return 'patched-project-event'\n\n"
            "def _auto_advance_stages():\n"
            "    markers = ('stage_auto_completion_state.json', 'stage_auto_completion_log.jsonl', 'stage_auto_completion_audit', 'auto_complete_stage', 'auto_completion', 'auto_completion_policies')\n"
            "    return 'patched-auto-completion'\n\n"
            "def api_export():\n"
            "    xlsx_filename = 'ProjectList_'\n"
            "    content_types = '[Content_Types].xml'\n"
            "    def build_workbook():\n"
            "        import openpyxl\n"
            "        return openpyxl.Workbook()\n"
            "    return 'patched-export'\n"
            + self.registration_replacement_source(),
            encoding="utf-8",
        )
        self.compile()

        with self.assertRaisesRegex(ValueError, "api_export_openpyxl=True"):
            self.tool.verify_patches(
                self.desktop_output,
                self.pyz_output,
                app_markers=("patched-get", "patched-update"),
                desktop_markers=("--startup-minimized",),
            )


if __name__ == "__main__":
    unittest.main()
