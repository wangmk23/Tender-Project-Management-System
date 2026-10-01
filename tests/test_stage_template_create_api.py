import types
import sys
import unittest
from datetime import date
from unittest import mock

from src.backend_patches import app_replacements as subject
from src.backend_patches import stage_templates


class Query:
    def filter_by(self, **values):
        return self

    def first(self):
        return None


class Project:
    query = Query()
    next_id = 100

    def __init__(self, **values):
        self.__dict__.update(values)
        self.id = Project.next_id
        Project.next_id += 1
        self.stages = []
        self.stage_checklist_items = []
        self.ensure_stages = mock.Mock()

    def to_dict(self):
        return {
            "id": self.id,
            "number": self.number,
            "name": self.name,
            "method": self.method,
            "stages": [],
        }


class StageTemplateCreateApiTests(unittest.TestCase):
    def setUp(self):
        self.subject_sentinel = object()
        self.subject_previous = {
            name: getattr(subject, name, self.subject_sentinel)
            for name in (
                "Project", "date", "db", "jsonify", "text", "log_operation",
                "METHODS", "STAGES", "load_app_settings", "request",
            )
        }
        self.previous_stage_templates = sys.modules.get("stage_templates")
        sys.modules["stage_templates"] = stage_templates
        self.session = types.SimpleNamespace(
            add=mock.Mock(), flush=mock.Mock(), commit=mock.Mock(),
            expire=mock.Mock(), execute=mock.Mock(),
        )
        subject.Project = Project
        subject.date = date
        subject.db = types.SimpleNamespace(session=self.session)
        subject.jsonify = lambda value: value
        subject.text = lambda value: value
        subject.log_operation = mock.Mock()
        subject.METHODS = list(stage_templates.PROCUREMENT_METHODS)
        subject.STAGES = [{"key": "legacy", "name": "旧阶段", "icon": "•"}]
        self.templates = {
            method: [{
                "id": f"method-{index}",
                "name": f"{method}专属阶段",
                "icon": "🔹",
                "modules": ["common", "checklist"],
            }]
            for index, method in enumerate(stage_templates.PROCUREMENT_METHODS)
        }
        subject.load_app_settings = lambda: {"stage_templates": self.templates}

    def tearDown(self):
        for name, value in self.subject_previous.items():
            if value is self.subject_sentinel:
                try:
                    delattr(subject, name)
                except AttributeError:
                    pass
            else:
                setattr(subject, name, value)
        if self.previous_stage_templates is None:
            sys.modules.pop("stage_templates", None)
        else:
            sys.modules["stage_templates"] = self.previous_stage_templates

    def test_each_procurement_method_creates_and_returns_only_its_snapshot(self):
        for index, method in enumerate(stage_templates.PROCUREMENT_METHODS):
            with self.subTest(method=method):
                subject.request = types.SimpleNamespace(get_json=lambda method=method: {
                    "number": f"PRJ-2026-{index:03d}",
                    "name": f"{method}项目",
                    "method": method,
                    "year": 2026,
                })
                expected = self.templates[method]
                with mock.patch.object(
                    stage_templates, "replace_v5_project_stage_snapshot"
                ) as replace_snapshot, mock.patch.object(
                    stage_templates, "initialize_online_bidding_scope"
                ) as initialize_scope, mock.patch.object(
                    stage_templates,
                    "serialize_v5_project_payload",
                    side_effect=lambda connection, sql_text, project, payload, settings, methods, stages: {
                        **payload,
                        "stages": [
                            {"key": row["id"], "name": row["name"], "icon": row["icon"], "completed": False}
                            for row in stage_templates.template_for_method(settings, project.method, methods, stages)
                        ],
                    },
                ):
                    response, status = subject.api_create_project()

                self.assertEqual(status, 201)
                initialize_scope.assert_called_once_with(self.session, subject.text, response['id'], method)
                self.assertEqual([row["key"] for row in response["stages"]], [f"method-{index}"])
                self.assertEqual(response["stages"][0]["name"], f"{method}专属阶段")
                written_template = replace_snapshot.call_args.args[3]
                self.assertEqual(written_template, expected)


if __name__ == "__main__":
    unittest.main()
