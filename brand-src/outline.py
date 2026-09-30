import json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

f = TTFont("Unbounded-Black.ttf")
gs = f.getGlyphSet()
cmap = f.getBestCmap()
upm = f["head"].unitsPerEm

def text_path(text, size, tracking_em=-0.02):
    scale = size / upm
    x = 0.0
    parts = []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (scale, 0, 0, -scale, x, 0))
        gs[g].draw(tp)
        parts.append(pen.getCommands())
        x += gs[g].width * scale + tracking_em * size
    x -= tracking_em * size
    return " ".join(parts), x

def bounds(text, size):
    from fontTools.pens.boundsPen import BoundsPen
    scale = size / upm; x = 0; xmin=ymin=1e9; xmax=ymax=-1e9
    for ch in text:
        g = cmap[ord(ch)]; bp = BoundsPen(gs); gs[g].draw(bp)
        if bp.bounds:
            a,b,c,d = bp.bounds
            xmin=min(xmin,x+a*scale); xmax=max(xmax,x+c*scale); ymin=min(ymin,-d*scale); ymax=max(ymax,-b*scale)
        x += gs[g].width*scale - 0.02*size
    return xmin,ymin,xmax,ymax

word, wadv = text_path("quants", 100)
q, qadv = text_path("q", 100, 0)
print(json.dumps({"word": word, "wadv": wadv, "wb": bounds("quants", 100), "q": q, "qb": bounds("q", 100)}))
