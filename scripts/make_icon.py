"""Generate a distinct desktop-shortcut icon for AI Orchestrator.

The previous icon reused the in-app logo (an orange 8-point starburst),
which reads too close to Claude's own mark and caused mix-ups on a
crowded desktop. This draws a different motif (a relay baton handoff,
in blue/teal) at multiple sizes into a single .ico.
"""

from PIL import Image, ImageDraw

SIZES = [16, 24, 32, 48, 64, 128, 256]

BG = (255, 255, 255, 0)
INK = (30, 41, 59, 255)       # slate-800, for outline accents
TEAL = (13, 148, 136, 255)    # teal-600 -- distinct from Claude's orange
TEAL_LIGHT = (94, 234, 212, 255)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    pad = size * 0.08
    r = size / 2

    # Rounded square badge background
    d.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=size * 0.22,
        fill=TEAL,
    )

    # Two overlapping rounded batons crossing like a handoff/relay,
    # in a lighter shade so they read against the teal badge.
    baton_w = size * 0.16
    inset = size * 0.28

    d.rounded_rectangle(
        [inset, size * 0.5 - baton_w / 2, size - inset, size * 0.5 + baton_w / 2],
        radius=baton_w / 2,
        fill=TEAL_LIGHT,
    )
    # small circles at each end to read as a baton, not just a bar
    for cx in (inset, size - inset):
        cy = size * 0.5
        rr = baton_w * 0.62
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 255, 255, 255))
        rr2 = baton_w * 0.34
        d.ellipse([cx - rr2, cy - rr2, cx + rr2, cy + rr2], fill=TEAL)

    return img


base = draw_icon(256)
imgs = [draw_icon(s) for s in SIZES]
base.save(
    "public/app-icon.ico",
    format="ICO",
    sizes=[(s, s) for s in SIZES],
)
print("wrote public/app-icon.ico")
