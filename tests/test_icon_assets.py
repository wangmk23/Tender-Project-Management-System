import importlib
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SIZES = {(size, size) for size in (16, 24, 32, 48, 64, 128, 256)}


class TransparentIconAssetTests(unittest.TestCase):
    def _module(self):
        try:
            return importlib.import_module("tools.build_icon_assets")
        except ModuleNotFoundError as exc:
            self.fail(f"transparent icon builder is missing: {exc}")

    def test_generated_icon_matches_checked_in_asset(self):
        module = self._module()
        svg = ROOT / "src" / "assets" / "app-icon-transparent.svg"
        checked_in = ROOT / "src" / "assets" / "app-icon-transparent.ico"

        self.assertTrue(svg.is_file(), svg)
        self.assertTrue(checked_in.is_file(), checked_in)
        with tempfile.TemporaryDirectory() as temp_dir:
            generated = Path(temp_dir) / "generated.ico"
            module.build_icon(svg, generated)
            self.assertEqual(generated.read_bytes(), checked_in.read_bytes())

    def test_all_icon_layers_are_transparent_centered_and_large(self):
        module = self._module()
        ico = ROOT / "src" / "assets" / "app-icon-transparent.ico"
        layers = module.load_icon_layers(ico)

        self.assertEqual(set(layers), EXPECTED_SIZES)
        for dimensions, image in layers.items():
            with self.subTest(size=dimensions[0]):
                self.assertEqual(image.mode, "RGBA")
                width, height = image.size
                corners = ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))
                self.assertTrue(all(image.getpixel(point)[3] == 0 for point in corners))

                effective_alpha = image.getchannel("A").point(
                    lambda alpha: 255 if alpha > 16 else 0
                )
                bounds = effective_alpha.getbbox()
                self.assertIsNotNone(bounds)
                visible_width = bounds[2] - bounds[0]
                visible_height = bounds[3] - bounds[1]
                coverage = max(visible_width, visible_height) / width
                self.assertGreaterEqual(coverage, 0.80)
                self.assertLessEqual(coverage, 0.88)

                left_margin = bounds[0]
                right_margin = width - bounds[2]
                top_margin = bounds[1]
                bottom_margin = height - bounds[3]
                self.assertLessEqual(abs(left_margin - right_margin), 2)
                self.assertLessEqual(abs(top_margin - bottom_margin), 2)

                old_background = (246, 249, 255)
                self.assertFalse(
                    any(
                        pixel[:3] == old_background and pixel[3] > 16
                        for pixel in image.get_flattened_data()
                    )
                )


if __name__ == "__main__":
    unittest.main()
