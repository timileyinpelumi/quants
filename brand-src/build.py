# Writes the mark, both logo lockups and the app icon from the traced atom in atom.json and the outlined wordmark in word.json.
# Run: python3 brand-src/build.py            (writes public/brand and src/app/icon.svg)
#      python3 brand-src/build.py <dir>      (writes the same files to <dir> for review)
import json, math, os, sys

here = os.path.dirname(os.path.abspath(__file__))
word = json.load(open(os.path.join(here, "word.json")))
atom = json.load(open(os.path.join(here, "atom.json")))

BLUE = atom["blue"]
TILE = "#000000"
INK_LIGHT = "#F4F2EE"
INK_DARK = "#0A0A0F"
POINTS = 72


def f(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def curve_points(c):
    k = (len(c["coef"]) - 1) // 2
    out = []
    for i in range(POINTS):
        t = 2 * math.pi * i / POINTS
        q = t - math.radians(c["t"])
        r = 1 / math.sqrt((math.cos(q) / c["a"]) ** 2 + (math.sin(q) / c["b"]) ** 2)
        r += c["coef"][0] + sum(c["coef"][2 * j - 1] * math.cos(j * t) + c["coef"][2 * j] * math.sin(j * t) for j in range(1, k + 1))
        out.append((c["cx"] + r * math.cos(t), c["cy"] + r * math.sin(t)))
    return out


def closed_path(pts):
    """Closed Catmull-Rom spline through pts, as cubic Beziers."""
    n = len(pts)
    d = [f"M{f(pts[0][0])} {f(pts[0][1])}"]
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f"C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}")
    return "".join(d) + "Z"


def ring_path(r):
    c = atom["curves"]
    return closed_path(curve_points(c[r + "o"])) + closed_path(curve_points(c[r + "i"]))


def glyph(uid, c=BLUE, gap=1.0):
    """The atom on its 1080 grid. Gaps are masks, so they cut through to whatever is behind."""
    front = atom["front"]
    back = "A" if front == "B" else "B"
    circ, gaps = atom["circles"], atom["gaps"]
    electrons = "".join(
        f'<circle cx="{f(circ[f"e{i}"][0])}" cy="{f(circ[f"e{i}"][1])}" r="{f(circ[f"e{i}"][2] + gaps["ge"][i] * gap)}"/>' for i in range(3))
    front_d = ring_path(front)
    return f'''<defs>
    <mask id="{uid}-back" maskUnits="userSpaceOnUse" x="0" y="0" width="1080" height="1080">
      <rect width="1080" height="1080" fill="#fff"/>
      <path d="{front_d}" fill-rule="evenodd" fill="#000" stroke="#000" stroke-width="{f(2 * gaps["gr"] * gap)}"/>
      <g fill="#000">{electrons}</g>
    </mask>
    <mask id="{uid}-front" maskUnits="userSpaceOnUse" x="0" y="0" width="1080" height="1080">
      <rect width="1080" height="1080" fill="#fff"/>
      <g fill="#000">{electrons}</g>
    </mask>
  </defs>
  <g fill="{c}">
    <path d="{ring_path(back)}" fill-rule="evenodd" mask="url(#{uid}-back)"/>
    <path d="{front_d}" fill-rule="evenodd" mask="url(#{uid}-front)"/>
    {"".join(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}"/>' for x, y, r in (circ[k] for k in ["e0", "e1", "e2", "n"]))}
  </g>'''


def mark_svg(uid="qm", gap=1.0, crop=0):
    v = f"{crop} {crop} {1080 - 2 * crop} {1080 - 2 * crop}"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{v}" role="img" aria-label="quants">
  <rect x="{crop}" y="{crop}" width="{1080 - 2 * crop}" height="{1080 - 2 * crop}" fill="{TILE}"/>
  {glyph(uid, gap=gap)}
</svg>
'''


# Atom bounds on its grid, so the lockup starts at the glyph.
LEFT, TOP, RIGHT, BOTTOM = 196, 231, 929, 850


def logo_svg(ink, uid):
    s = 1.12
    x0, _, x1, _ = word["bounds"]
    h = 100
    k = h / (BOTTOM - TOP)
    gap = 26
    base = 64 + 25 * s
    start = (RIGHT - LEFT) * k + gap
    width = start + (x1 - x0) * s
    top = (128 - h) / 2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} 128" role="img" aria-label="quants">
  <g transform="translate({-LEFT * k:.2f} {top - TOP * k:.2f}) scale({k:.5f})">{glyph(uid)}</g>
  <path transform="translate({start - x0 * s:.2f} {base:.2f}) scale({s})" d="{word["path"]}" fill="{ink}"/>
</svg>
'''


out = sys.argv[1] if len(sys.argv) > 1 else None
brand = out or os.path.join(here, "..", "public", "brand")
app = out or os.path.join(here, "..", "src", "app")
open(os.path.join(brand, "quants-mark.svg"), "w").write(mark_svg())
# Small uses (tab icon, header, footer) are drawn at 16 to 64px: a tighter crop and wider gaps keep the rings apart.
icon = mark_svg("qi", gap=1.6, crop=150)
open(os.path.join(app, "icon.svg"), "w").write(icon)
open(os.path.join(brand, "quants-icon.svg"), "w").write(icon)
open(os.path.join(brand, "quants-logo.svg"), "w").write(logo_svg(INK_LIGHT, "ql"))
open(os.path.join(brand, "quants-logo-dark.svg"), "w").write(logo_svg(INK_DARK, "qd"))
