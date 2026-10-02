# Outlines the wordmark into word.json so the logo SVGs need no font.
# Usage: python3 outline.py Bricolage-ExtraBold.ttf
# Make the font with: fonttools varLib.instancer "BricolageGrotesque[opsz,wdth,wght].ttf" wght=800 opsz=48 wdth=100 -o Bricolage-ExtraBold.ttf
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

TEXT, SIZE, TRACKING = "quants", 100, -0.03

f = TTFont(sys.argv[1])
gs, cmap, upm = f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm
scale = SIZE / upm
x, parts = 0.0, []
xmin = ymin = 1e9
xmax = ymax = -1e9
for ch in TEXT:
    g = cmap[ord(ch)]
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    gs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
    parts.append(pen.getCommands())
    bp = BoundsPen(gs)
    gs[g].draw(bp)
    if bp.bounds:
        a, b, c, d = bp.bounds
        xmin, xmax = min(xmin, x + a * scale), max(xmax, x + c * scale)
        ymin, ymax = min(ymin, -d * scale), max(ymax, -b * scale)
    x += gs[g].width * scale + TRACKING * SIZE

# Path is drawn at font size 100 with the baseline at y=0; bounds are [xmin, ymin, xmax, ymax].
out = {"font": os.path.basename(sys.argv[1]), "size": SIZE, "path": " ".join(parts), "bounds": [round(v, 2) for v in (xmin, ymin, xmax, ymax)]}
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "word.json"), "w"))
print(out["bounds"])
