import copy
import unittest

try:
    from src.backend_patches import stage_workflow
except ImportError:
    stage_workflow = None


class StageWorkflowAvailabilityTests(unittest.TestCase):
    def test_stage_workflow_module_is_available(self):
        self.assertIsNotNone(stage_workflow, "stage_workflow module must exist")


@unittest.skipIf(stage_workflow is None, "stage_workflow module is not implemented")
class StageWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.stages = [
            {"key": "plan", "name": "计划接收"},
            {"key": "review", "name": "文件审核"},
            {"key": "award", "name": "结果公示"},
        ]

    def test_strict_order_accepts_only_an_exact_permutation(self):
        valid = stage_workflow.normalize_stage_order(
            ["award", "plan", "review"], self.stages, strict=True
        )
        self.assertEqual(valid, ["award", "plan", "review"])

        invalid_values = (
            None,
            "award,plan,review",
            ["award", "plan"],
            ["award", "plan", "plan"],
            ["award", "plan", "unknown"],
            ["award", "plan", 3],
        )
        for raw in invalid_values:
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(
                    stage_workflow.StageOrderValidationError,
                    "阶段顺序必须包含全部阶段且不得重复",
                ):
                    stage_workflow.normalize_stage_order(
                        raw, self.stages, strict=True
                    )

    def test_invalid_persisted_order_falls_back_to_the_whole_default(self):
        warnings = []
        actual = stage_workflow.normalize_stage_order(
            ["award"], self.stages, warn=warnings.append
        )
        self.assertEqual(actual, ["plan", "review", "award"])
        self.assertEqual(warnings, ["invalid stage_order; using defaults"])

    def test_missing_persisted_order_uses_default_without_warning(self):
        warnings = []
        actual = stage_workflow.normalize_stage_order(
            None, self.stages, warn=warnings.append
        )
        self.assertEqual(actual, ["plan", "review", "award"])
        self.assertEqual(warnings, [])

    def test_ordered_definitions_preserve_stage_metadata(self):
        actual = stage_workflow.ordered_stage_definitions(
            self.stages,
            {"stage_order": ["review", "award", "plan"]},
        )
        self.assertEqual(
            [(row["key"], row["name"]) for row in actual],
            [
                ("review", "文件审核"),
                ("award", "结果公示"),
                ("plan", "计划接收"),
            ],
        )

    def test_payload_uses_reordered_current_and_next_without_mutating_source(self):
        source = {
            "id": 7,
            "stages": [
                {"key": "plan", "completed": False, "skipped": False},
                {"key": "review", "completed": True, "skipped": False},
                {"key": "award", "completed": False, "skipped": False},
            ],
        }
        original = copy.deepcopy(source)

        result = stage_workflow.apply_project_payload(
            source,
            {"stage_order": ["review", "award", "plan"]},
            self.stages,
        )

        self.assertEqual(
            [row["key"] for row in result["stages"]],
            ["review", "award", "plan"],
        )
        self.assertEqual(result["current_stage_key"], "award")
        self.assertEqual(result["next_stage_key"], "plan")
        self.assertEqual(source, original)

    def test_payload_accepts_stage_key_and_places_unknown_rows_last(self):
        source = {
            "stages": [
                {"stage_key": "external", "completed": False, "skipped": False},
                {"stage_key": "plan", "completed": False, "skipped": False},
                {"stage_key": "review", "completed": False, "skipped": True},
                {"stage_key": "award", "completed": True, "skipped": False},
            ]
        }

        result = stage_workflow.apply_project_payload(
            source,
            {"stage_order": ["award", "review", "plan"]},
            self.stages,
        )

        self.assertEqual(
            [row["stage_key"] for row in result["stages"]],
            ["award", "review", "plan", "external"],
        )
        self.assertEqual(result["current_stage_key"], "plan")
        self.assertIsNone(result["next_stage_key"])

    def test_all_terminal_stages_clear_current_and_next(self):
        source = {
            "stages": [
                {"key": "plan", "completed": True, "skipped": False},
                {"key": "review", "completed": False, "skipped": True},
                {"key": "award", "completed": True, "skipped": False},
            ]
        }
        result = stage_workflow.apply_project_payload(source, {}, self.stages)
        self.assertIsNone(result["current_stage_key"])
        self.assertIsNone(result["next_stage_key"])


if __name__ == "__main__":
    unittest.main()
