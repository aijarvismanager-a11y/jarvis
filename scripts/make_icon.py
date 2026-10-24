"""Draws the AI Orchestrator icon: a conductor node (bottom) linked to three AI nodes (top).

Writes public/app-icon.png, public/app-icon.ico and public/favicon.svg. Run: python scripts/make_icon.py
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public"
TOP, BOTTOM = (224, 128, 96), (160, 66, 42)   # terracotta gradient
CREAM = (251, 246, 238)
S = 1024  # drawn large, then scaled down for smooth edges

# geometry on a 0..1 canvas
CONDUCTOR = (0.5, 0.70)
NODES = [(0.25, 0.30), (0.5, 0.22), (0.75, 0.30)]


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg = Image.new("RGBA", (S, S))
    px = bg.load()
    for y in range(S):
        t = y / (S - 1)
        c = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,)
        for x in range(S):
            px[x, y] = c
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([S * 0.04, S * 0.04, S * 0.96, S * 0.96], radius=S * 0.22, fill=255)
    img.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(img)
    cx, cy = CONDUCTOR[0] * S, CONDUCTOR[1] * S
    for nx, ny in NODES:  # spokes: thick lines with round ends
        x, y = nx * S, ny * S
        d.line([(cx, cy), (x, y)], fill=CREAM, width=int(S * 0.045))
    for nx, ny in NODES:
        x, y = nx * S, ny * S
        r = S * 0.085
        d.ellipse([x - r, y - r, x + r, y + r], fill=CREAM)
    r = S * 0.15  # conductor: ring with a solid core
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=CREAM)
    r2 = S * 0.075
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(190, 84, 56))
    return img.resize((size, size), Image.LANCZOS)


big = render(512)
big.save(OUT / "app-icon.png")
render(256).save(OUT / "app-icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

def svg() -> str:
    def p(v):
        return f"{v * 100:.1f}"
    cx, cy = CONDUCTOR
    lines = "".join(f'<line x1="{p(cx)}" y1="{p(cy)}" x2="{p(x)}" y2="{p(y)}"/>' for x, y in NODES)
    dots = "".join(f'<circle cx="{p(x)}" cy="{p(y)}" r="8.5"/>' for x, y in NODES)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#e08060"/><stop offset="1" stop-color="#a0422a"/></linearGradient></defs>'
        '<rect x="4" y="4" width="92" height="92" rx="22" fill="url(#g)"/>'
        f'<g stroke="#fbf6ee" stroke-width="4.5" stroke-linecap="round">{lines}</g><g fill="#fbf6ee">{dots}<circle cx="{p(cx)}" cy="{p(cy)}" r="15"/></g>'
        f'<circle cx="{p(cx)}" cy="{p(cy)}" r="7.5" fill="#be5438"/></svg>'
    )

(OUT / "favicon.svg").write_text(svg(), encoding="utf-8")
