import importlib.util
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "src" / "backend_patches" / "lot_supplier_risk.py"


class WarningBaselineIntegrationTests(unittest.TestCase):
    def test_one_missing_supplier_is_reported_as_warning(self):
        if not MODULE_PATH.is_file():
            self.fail("warning-edition supplier risk module is missing")
        spec = importlib.util.spec_from_file_location(
            "warning_baseline_under_test",
            MODULE_PATH,
        )
        subject = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(subject)
        lot = SimpleNamespace(
            id=11,
            lot_number="01包",
            lot_name="办公设备采购",
            supplier_control=None,
        )
        registrations = [
            SimpleNamespace(id=1, lot_id=11),
            SimpleNamespace(id=2, lot_id=11),
        ]
        project = SimpleNamespace(
            id=7,
            method="公开招标",
            lots=[lot],
            registrations=registrations,
            stages=[
                SimpleNamespace(
                    stage_key="registration_end",
                    planned_datetime=datetime(2026, 8, 10, 17, 0),
                )
            ],
            is_terminated=False,
        )

        snapshot = subject.build_project_snapshot(
            None,
            project,
            datetime(2026, 8, 9, 9, 0),
            {"supplier_minimums": subject.DEFAULT_MINIMUMS},
        )

        self.assertEqual(snapshot["warning_count"], 1)
        self.assertEqual(snapshot["items"][0]["missing_count"], 1)
        self.assertEqual(snapshot["items"][0]["status"], "warning")


if __name__ == "__main__":
    unittest.main()
