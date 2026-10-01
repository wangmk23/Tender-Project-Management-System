import re
import unittest
from pathlib import Path


CSS_PATH = Path(__file__).resolve().parents[1] / "src" / "static" / "style.css"


def declarations(css: str, selector: str) -> list[str]:
    pattern = re.compile(re.escape(selector) + r"\s*\{([^}]+)\}", re.IGNORECASE)
    return [match.group(1).replace(" ", "").lower() for match in pattern.finditer(css)]


class ModalLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = CSS_PATH.read_text(encoding="utf-8-sig")

    def test_base_modal_has_stable_top_anchor(self):
        rules = declarations(self.css, ".modal")
        self.assertTrue(rules, "missing .modal rule")
        base = rules[0]
        self.assertNotIn("top:50%", base)
        self.assertNotIn("translate(-50%,-50%)", base)
        self.assertIn("top:7.5vh", base)
        self.assertIn("transform:translatex(-50%)", base)
        self.assertIn("max-height:85vh", base)

    def test_modal_body_is_the_stable_scroll_container(self):
        body = declarations(self.css, ".modal-body")[0]
        self.assertIn("flex:11auto", body)
        self.assertIn("min-height:0", body)
        self.assertIn("overflow-y:auto", body)
        self.assertIn("overscroll-behavior:contain", body)
        self.assertIn("scrollbar-gutter:stable", body)

    def test_header_and_footer_do_not_resize_with_body(self):
        combined = declarations(self.css, ".modal-header,.modal-footer")
        self.assertTrue(combined, "missing shared fixed header/footer rule")
        self.assertIn("flex:00auto", combined[0])

    def test_mobile_modal_uses_fixed_five_vh_top(self):
        mobile_rules = declarations(self.css, ".modal")
        self.assertTrue(
            any("top:5vh" in rule and "max-height:90vh" in rule for rule in mobile_rules[1:]),
            "mobile .modal rule must use top:5vh and max-height:90vh",
        )


if __name__ == "__main__":
    unittest.main()
