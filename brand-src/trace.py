# Fits the atom mark's shapes to a reference PNG by rasterizing the model and minimizing pixel error.
# Step 1. Usage: python3 brand-src/trace.py reference.png   (writes brand-src/.fit/fit.json for refine.py)
import json, os, sys
import cv2
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
SIZE = 1080

NAMES = ["nx", "ny", "nr"] + [f"e{i}{k}" for i in range(3) for k in "xyr"] + \
    [f"{r}{k}" for r in "AB" for k in ["ox", "oy", "oa", "ob", "ot", "ix", "iy", "ia", "ib", "it"]] + ["ge", "gr"]


def blue_mask(path):
    im = cv2.imread(path)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    m = (hsv[..., 1] > 120) & (hsv[..., 2] > 120)
    med = np.median(im[m], axis=0)
    return m.astype(np.float32), "#%02X%02X%02X" % (int(med[2]), int(med[1]), int(med[0]))


def grid(m, s):
    t = cv2.resize(m, (s, s), interpolation=cv2.INTER_AREA)
    c = (np.arange(s) + 0.5) * SIZE / s
    x, y = np.meshgrid(c, c)
    return t, x, y


def ell(x, y, cx, cy, a, b, th):
    t = np.radians(th)
    c, s = np.cos(t), np.sin(t)
    dx, dy = x - cx, y - cy
    u = dx * c + dy * s
    v = -dx * s + dy * c
    return (u / a) ** 2 + (v / b) ** 2 <= 1


def ring(x, y, p, r, grow=0.0):
    o = ell(x, y, p[r + "ox"], p[r + "oy"], p[r + "oa"] + grow, p[r + "ob"] + grow, p[r + "ot"])
    i = ell(x, y, p[r + "ix"], p[r + "iy"], max(p[r + "ia"] - grow, 1), max(p[r + "ib"] - grow, 1), p[r + "it"])
    return o & ~i


def render(p, x, y, front):
    back = "A" if front == "B" else "B"
    img = ring(x, y, p, back)
    img &= ~ring(x, y, p, front, p["gr"])
    img |= ring(x, y, p, front)
    for i in range(3):
        d = (x - p[f"e{i}x"]) ** 2 + (y - p[f"e{i}y"]) ** 2
        img &= ~(d <= (p[f"e{i}r"] + p["ge"]) ** 2)
        img |= d <= p[f"e{i}r"] ** 2
    img |= (x - p["nx"]) ** 2 + (y - p["ny"]) ** 2 <= p["nr"] ** 2
    return img


def err(p, g, front):
    t, x, y = g
    return float(np.abs(render(p, x, y, front) - t).sum() * (SIZE / len(t)) ** 2)


def descend(p, g, front, steps, rounds):
    best = err(p, g, front)
    for st in steps:
        for _ in range(rounds):
            better = False
            for k in NAMES:
                d = st * (0.5 if k.endswith(("ot", "it")) else 1)
                for sgn in (1, -1):
                    q = dict(p)
                    q[k] += sgn * d
                    e = err(q, g, front)
                    if e < best:
                        best, p, better = e, q, True
                        break
            if not better:
                break
        print(front, st, round(best), flush=True)
    return p, best


START = dict(
    nx=553, ny=561, nr=77, e0x=430, e0y=415, e0r=40, e1x=755, e1y=403, e1r=53, e2x=379, e2y=696, e2r=49,
    Aox=565, Aoy=540, Aoa=330, Aob=175, Aot=-60, Aix=565, Aiy=540, Aia=280, Aib=157, Ait=-60,
    Box=562, Boy=530, Boa=375, Bob=155, Bot=-12, Bix=562, Biy=530, Bia=330, Bib=137, Bit=-12, ge=10, gr=10,
)

if __name__ == "__main__":
    m, blue = blue_mask(sys.argv[1])
    os.makedirs(os.path.join(here, ".fit"), exist_ok=True)
    out = os.path.join(here, ".fit", "fit.json")
    p0 = json.load(open(out))["p"] if os.path.exists(out) and "--resume" in sys.argv else START
    fronts = [json.load(open(out))["front"]] if "--resume" in sys.argv else ["A", "B"]
    res = {}
    for f in fronts:
        q, _ = descend(dict(p0), grid(m, 270), f, [8, 4, 2], 30)
        res[f] = descend(q, grid(m, 540), f, [2, 1], 30)[::-1]
    front = min(res, key=lambda k: res[k][0])
    p, _ = descend(res[front][1], grid(m, SIZE), front, [1, 0.5, 0.25], 40)
    t, x, y = grid(m, SIZE)
    r = render(p, x, y, front)
    tb = t > 0.5
    iou = float((r & tb).sum() / (r | tb).sum())
    print("front", front, "IoU", round(iou, 4), "blue", blue)
    json.dump({"blue": blue, "front": front, "iou": iou, "p": {k: round(v, 2) for k, v in p.items()}}, open(out, "w"), indent=1)
