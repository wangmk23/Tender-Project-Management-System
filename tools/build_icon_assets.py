"""Render the transparent application SVG into a deterministic multi-size ICO."""

from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import IcoImagePlugin, Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SVG = ROOT / "src" / "assets" / "app-icon-transparent.svg"
DEFAULT_ICO = ROOT / "src" / "assets" / "app-icon-transparent.ico"
ICON_SIZES = (16, 24, 32, 48, 64, 128, 256)
SUPERSAMPLE = 8
SVG_NAMESPACE = "http://www.w3.org/2000/svg"
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_color(value: str, opacity: float) -> tuple[int, int, int, int]:
    if not HEX_COLOR.fullmatch(value):
        raise ValueError(f"unsupported SVG fill: {value!r}")
    return (
        int(value[1:3], 16),
        int(value[3:5], 16),
        int(value[5:7], 16),
        round(255 * opacity),
    )


def render_svg_rectangles(svg_path: Path | str, output_size: int) -> Image.Image:
    """Render the project's intentionally small, rectangle-only SVG subset."""

    svg_path = Path(svg_path)
    root = ET.parse(svg_path).getroot()
    if _local_name(root.tag) != "svg":
        raise ValueError("icon source root must be an SVG element")
    if root.tag.startswith("{") and not root.tag.startswith(f"{{{SVG_NAMESPACE}}}"):
        raise ValueError("icon source uses an unsupported SVG namespace")

    view_box = root.attrib.get("viewBox", "").split()
    if len(view_box) != 4:
        raise ValueError("icon source must define a four-number viewBox")
    min_x, min_y, view_width, view_height = map(float, view_box)
    if min_x != 0 or min_y != 0 or view_width != view_height or view_width <= 0:
        raise ValueError("icon source viewBox must be a positive square starting at zero")
    if output_size <= 0:
        raise ValueError("output size must be positive")

    canvas = Image.new("RGBA", (output_size, output_size), (0, 0, 0, 0))
    scale = output_size / view_width
    allowed_attributes = {"x", "y", "width", "height", "rx", "fill", "opacity"}
    for element in root:
        if _local_name(element.tag) != "rect":
            raise ValueError(f"unsupported SVG element: {_local_name(element.tag)!r}")
        unexpected = set(element.attrib) - allowed_attributes
        if unexpected:
            raise ValueError(f"unsupported rect attributes: {sorted(unexpected)!r}")
        x = float(element.attrib["x"])
        y = float(element.attrib["y"])
        width = float(element.attrib["width"])
        height = float(element.attrib["height"])
        radius = float(element.attrib.get("rx", "0"))
        opacity = float(element.attrib.get("opacity", "1"))
        if width <= 0 or height <= 0 or radius < 0 or not 0 <= opacity <= 1:
            raise ValueError("icon rectangle geometry or opacity is invalid")

        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        draw.rounded_rectangle(
            (
                round(x * scale),
                round(y * scale),
                round((x + width) * scale),
                round((y + height) * scale),
            ),
            radius=round(radius * scale),
            fill=_parse_color(element.attrib["fill"], opacity),
        )
        canvas = Image.alpha_composite(canvas, layer)
    return canvas


def build_icon(svg_path: Path | str, ico_path: Path | str) -> None:
    """Build all required Windows icon sizes from the SVG master."""

    ico_path = Path(ico_path)
    master = render_svg_rectangles(svg_path, 256 * SUPERSAMPLE)
    master = master.resize((256, 256), Image.Resampling.LANCZOS)
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    master.save(
        ico_path,
        format="ICO",
        sizes=[(size, size) for size in ICON_SIZES],
        bitmap_format="png",
    )


def load_icon_layers(ico_path: Path | str) -> dict[tuple[int, int], Image.Image]:
    """Return every embedded ICO layer as an independent RGBA image."""

    with Path(ico_path).open("rb") as stream:
        icon = IcoImagePlugin.IcoFile(stream)
        return {
            size: icon.getimage(size).convert("RGBA").copy()
            for size in sorted(icon.sizes())
        }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--svg", type=Path, default=DEFAULT_SVG)
    parser.add_argument("--out", type=Path, default=DEFAULT_ICO)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    build_icon(args.svg, args.out)
    sizes = ", ".join(f"{width}x{height}" for width, height in load_icon_layers(args.out))
    print(f"icon: {args.out}")
    print(f"sizes: {sizes}")


if __name__ == "__main__":
    main()
