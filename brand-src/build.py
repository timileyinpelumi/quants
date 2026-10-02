# Writes the mark, both logo lockups and the app icon from shapes and the outlined wordmark in word.json.
# Run: python3 brand-src/build.py            (writes public/brand and src/app/icon.svg)
#      python3 brand-src/build.py <dir>      (writes every concept to <dir> for review)
import json, math, os, sys

here = os.path.dirname(os.path.abspath(__file__))
word = json.load(open(os.path.join(here, "word.json")))

BLUE = "#4C9DFF"
TILE = "#12121A"
INK_LIGHT = "#F4F2EE"
INK_DARK = "#0A0A0F"
CHOSEN = 2


def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return f"{cx + r * math.cos(a):.2f} {cy + r * math.sin(a):.2f}"


def glyph(n, c=BLUE):
    """The mark's shape on a 128 grid, no background."""
    if n == 1:
        # broken ring with a launch arrow leaving it to the top right
        cx, cy, r = 58, 70, 31
        return f'''<path d="M{pt(cx, cy, r, -22)} A{r} {r} 0 1 1 {pt(cx, cy, r, -68)}" fill="none" stroke="{c}" stroke-width="18"/>
  <path d="M{pt(cx, cy, 0, 0)} L{pt(cx, cy, 44, -45)}" stroke="{c}" stroke-width="18"/>
  <path d="M{pt(cx, cy, 68, -45)} L{pt(cx, cy, 36, -45 + 33)} L{pt(cx, cy, 36, -45 - 33)} Z" fill="{c}"/>'''
    if n == 2:
        # geometric q: ring bowl, square stem, and a detached square at the foot
        return f'''<circle cx="64" cy="48" r="23" fill="none" stroke="{c}" stroke-width="18"/>
  <rect x="78" y="48" width="18" height="40" fill="{c}"/>
  <rect x="78" y="94" width="18" height="18" fill="{c}"/>'''
    if n == 3:
        # token disc with a reward orbiting it on an open ring
        cx, cy = 64, 64
        return f'''<circle cx="{cx}" cy="{cy}" r="19" fill="{c}"/>
  <path d="M{pt(cx, cy, 41, 150)} A41 41 0 1 1 {pt(cx, cy, 41, 75)}" fill="none" stroke="{c}" stroke-width="12" stroke-linecap="round"/>
  <circle cx="{pt(cx, cy, 41, 112).split()[0]}" cy="{pt(cx, cy, 41, 112).split()[1]}" r="10" fill="{c}"/>'''
    raise ValueError(n)


def mark_svg(n):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="quants">
  <rect width="128" height="128" rx="30" fill="{TILE}"/>
  <rect x="0.5" y="0.5" width="127" height="127" rx="29.5" fill="none" stroke="#FFFFFF" stroke-opacity="0.10"/>
  {glyph(n)}
</svg>
'''


# Left and right edges of each glyph on the 128 grid, so the lockup starts at the glyph, not the tile.
EDGES = {1: (18, 106), 2: (32, 96), 3: (17, 111)}


def logo_svg(n, ink):
    s = 1.12
    x0, _, x1, _ = word["bounds"]
    left, right = EDGES[n]
    gap = 30
    base = 64 + 25 * s
    start = right - left + gap
    width = start + (x1 - x0) * s
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} 128" role="img" aria-label="quants">
  <g transform="translate({-left} 0)">{glyph(n)}</g>
  <path transform="translate({start - x0 * s:.2f} {base:.2f}) scale({s})" d="{word["path"]}" fill="{ink}"/>
</svg>
'''


if len(sys.argv) > 1:
    out = sys.argv[1]
    for n in (1, 2, 3):
        open(os.path.join(out, f"concept-{n}-mark.svg"), "w").write(mark_svg(n))
        open(os.path.join(out, f"concept-{n}-logo.svg"), "w").write(logo_svg(n, INK_LIGHT))
        open(os.path.join(out, f"concept-{n}-logo-dark.svg"), "w").write(logo_svg(n, INK_DARK))
    sys.exit(0)

brand = os.path.join(here, "..", "public", "brand")
open(os.path.join(brand, "quants-mark.svg"), "w").write(mark_svg(CHOSEN))
open(os.path.join(here, "..", "src", "app", "icon.svg"), "w").write(mark_svg(CHOSEN))
open(os.path.join(brand, "quants-logo.svg"), "w").write(logo_svg(CHOSEN, INK_LIGHT))
open(os.path.join(brand, "quants-logo-dark.svg"), "w").write(logo_svg(CHOSEN, INK_DARK))
