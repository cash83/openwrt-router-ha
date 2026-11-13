"""Draw the icon (a house holding a Wi-Fi signal) for the integration and the app.

One geometry, on the 108-unit grid Android uses for adaptive icons, so the PNGs
Home Assistant shows and the launcher icon are the same drawing.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CYAN = (77, 184, 232, 255)
WHITE = (255, 255, 255, 255)
DARK_TOP = (22, 32, 43)
DARK_BOTTOM = (9, 12, 17)

GRID = 108
ROOF = [(30, 56), (54, 34), (78, 56)]
WALLS = [(36, 52), (36, 80), (72, 80), (72, 52)]
DOT = (54, 72, 3.6)
ARCS = [(54, 72, 9), (54, 72, 17)]
STROKE = 5.2


def _line(draw: ImageDraw.ImageDraw, points, colour, width, k):
    scaled = [(x * k, y * k) for x, y in points]
    draw.line(scaled, fill=colour, width=round(width * k), joint="curve")
    radius = width * k / 2
    for x, y in scaled:
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=colour)


def _arc(draw, cx, cy, r, colour, width, k):
    points = [
        (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
        for a in range(225, 316, 3)
    ]
    _line(draw, points, colour, width, k)


def glyph(size: int, scale: float = 1.0) -> Image.Image:
    """The drawing alone, transparent, `scale` > 1 to fill more of the square."""
    over = 4
    canvas = Image.new("RGBA", (size * over, size * over), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    k = size * over / GRID * scale
    shift = GRID * (1 - scale) / 2 / scale
    move = lambda pts: [(x + shift, y + shift) for x, y in pts]  # noqa: E731
    _line(draw, move(WALLS), CYAN, STROKE, k)
    _line(draw, move(ROOF), CYAN, STROKE, k)
    for cx, cy, r in ARCS:
        _arc(draw, cx + shift, cy + shift, r, WHITE, STROKE * 0.85, k)
    x, y, r = DOT
    draw.ellipse(
        [(x + shift - r) * k, (y + shift - r) * k, (x + shift + r) * k, (y + shift + r) * k],
        fill=WHITE,
    )
    return canvas.resize((size, size), Image.LANCZOS)


def tile(size: int) -> Image.Image:
    """The drawing on its dark rounded tile."""
    over = 4
    big = size * over
    gradient = Image.new("RGBA", (big, big))
    pixels = ImageDraw.Draw(gradient)
    for y in range(big):
        t = y / (big - 1)
        colour = tuple(round(a + (b - a) * t) for a, b in zip(DARK_TOP, DARK_BOTTOM)) + (255,)
        pixels.line([(0, y), (big, y)], fill=colour)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.2, fill=255)
    gradient.putalpha(mask)
    out = gradient.resize((size, size), Image.LANCZOS)
    out.alpha_composite(glyph(size, scale=1.5))
    return out


def main() -> None:
    brand = ROOT / "custom_components" / "openwrt_router" / "brand"
    brand.mkdir(exist_ok=True)
    # The tile is dark by design and reads well on both themes, so the dark
    # variants Home Assistant asks for on a dark theme are the same picture.
    for prefix in ("", "dark_"):
        for name, size in (("icon.png", 256), ("icon@2x.png", 512), ("logo.png", 256), ("logo@2x.png", 512)):
            tile(size).save(brand / (prefix + name))
    tile(512).save(ROOT / "icon.png")
    (ROOT / "android" / "store").mkdir(exist_ok=True)
    tile(512).save(ROOT / "android" / "store" / "icona-512.png")
    print("icons written")


if __name__ == "__main__":
    main()
