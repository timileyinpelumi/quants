# Step 2: refits each ring edge as an ellipse plus a Fourier series in radius, from .fit/fit.json.
# Usage: python3 brand-src/refine.py reference.png [harmonics] [smoothing]
import json, sys, numpy as np, cv2
import os
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.fit') + '/'
os.makedirs(S, exist_ok=True)
REF = sys.argv[1]
K = int(sys.argv[2]) if len(sys.argv) > 2 else 8
LAM = float(sys.argv[3]) if len(sys.argv) > 3 else 1e-4
im = cv2.imread(REF)
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
mask = (hsv[..., 1] > 120) & (hsv[..., 2] > 120)
F = np.clip(im[..., 0].astype(np.float32) / 253.0, 0, 1)  # antialiased coverage from the blue channel
d = json.load(open(S + 'fit.json')); p = d['p']; front = d['front']

cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
P0 = np.concatenate([c.reshape(-1, 2) for c in cs]).astype(float)
G = cv2.GaussianBlur(F, (0, 0), 1.5)
gy, gx = np.gradient(G)


def bil(img, x, y):
    x0 = np.clip(np.floor(x).astype(int), 0, 1078); y0 = np.clip(np.floor(y).astype(int), 0, 1078)
    fx = x - x0; fy = y - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


# subpixel edge: walk from the pixel centre along the outward normal to where coverage crosses 0.5
nx = -bil(gx, P0[:, 0], P0[:, 1]); ny = -bil(gy, P0[:, 0], P0[:, 1])
nn = np.hypot(nx, ny) + 1e-9; nx /= nn; ny /= nn
ss = np.arange(-1.5, 2.5, 0.02)
vals = np.stack([bil(F, P0[:, 0] + s * nx, P0[:, 1] + s * ny) for s in ss], 1)
idx = np.argmin(np.abs(vals - 0.5) + (ss[None, :] < -0.6) * 9, 1)
P = np.c_[P0[:, 0] + ss[idx] * nx, P0[:, 1] + ss[idx] * ny]


def rell(th, a, b, t):
    q = th - np.radians(t)
    return 1 / np.sqrt((np.cos(q) / a) ** 2 + (np.sin(q) / b) ** 2)


def basis(t, k):
    cols = [np.ones_like(t)]
    for j in range(1, k + 1): cols += [np.cos(j * t), np.sin(j * t)]
    return np.stack(cols, 1)


def curve_poly(c, n=1440):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    r = basis(t, (len(c['coef']) - 1) // 2) @ np.array(c['coef']) + rell(t, c['a'], c['b'], c['t'])
    return np.c_[c['cx'] + r * np.cos(t), c['cy'] + r * np.sin(t)]


def circ_poly(cx, cy, r, n=720):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return np.c_[cx + r * np.cos(t), cy + r * np.sin(t)]


def offset(poly, g):
    # outward offset of a closed ccw-or-cw polyline by g (sign picked so it grows)
    d = np.roll(poly, -1, 0) - np.roll(poly, 1, 0)
    n = np.c_[d[:, 1], -d[:, 0]]; n /= np.linalg.norm(n, axis=1, keepdims=True)
    c = poly.mean(0)
    if ((poly - c) * n).sum() < 0: n = -n
    return poly + g * n


C = {}
for R in 'AB':
    for io in 'oi':
        C[R + io] = {'cx': p[R + io + 'x'], 'cy': p[R + io + 'y'], 'a': p[R + io + 'a'], 'b': p[R + io + 'b'], 't': p[R + io + 't'], 'coef': [0.0] * (2 * K + 1)}
circ = {f'e{i}': [p[f'e{i}x'], p[f'e{i}y'], p[f'e{i}r']] for i in range(3)}
circ['n'] = [p['nx'], p['ny'], p['nr']]
gaps = {'gr': p['gr'], 'ge': [p['ge']] * 3}


def dist_to(poly):
    out = np.empty(len(P))
    for s in range(0, len(P), 4000):
        out[s:s + 4000] = np.sqrt(((P[s:s + 4000, None, :] - poly[None, ::2, :]) ** 2).sum(-1)).min(1)
    return out


for it in range(4):
    curves = {k: curve_poly(v) for k, v in C.items()}
    fr = front
    curves[fr + 'og'] = offset(curves[fr + 'o'], gaps['gr']); curves[fr + 'ig'] = offset(curves[fr + 'i'], -gaps['gr'])
    for k, (cx, cy, r) in circ.items():
        curves[k] = circ_poly(cx, cy, r)
        if k != 'n': curves['g' + k] = circ_poly(cx, cy, r + gaps['ge'][int(k[1])])
    keys = list(curves)
    D = np.stack([dist_to(curves[k]) for k in keys]); a = D.argmin(0); dm = D.min(0)
    second = np.sort(D, 0)[1]
    ok = (dm < 6) & (second > 3)  # skip points near corners where two curves meet
    for k in C:
        sel = (a == keys.index(k)) & ok; pts = P[sel]; c = C[k]
        th = np.arctan2(pts[:, 1] - c['cy'], pts[:, 0] - c['cx']); r = np.hypot(pts[:, 0] - c['cx'], pts[:, 1] - c['cy'])
        A = basis(th, K)
        reg = np.diag([0] + [LAM * j ** 4 for j in range(1, K + 1) for _ in (0, 1)]) * len(th)
        c['coef'] = np.linalg.solve(A.T @ A + reg, A.T @ (r - rell(th, c['a'], c['b'], c['t']))).tolist()
    for k in circ:
        sel = (a == keys.index(k)) & ok; pts = P[sel]
        M = np.c_[2 * pts, np.ones(len(pts))]; sol = np.linalg.lstsq(M, (pts ** 2).sum(1), rcond=None)[0]
        circ[k] = [sol[0], sol[1], float(np.sqrt(sol[2] + sol[0] ** 2 + sol[1] ** 2))]
    # gap widths from the points on gap edges
    sel = (a == keys.index(fr + 'og')) & ok
    if sel.sum() > 10: gaps['gr'] = float(gaps['gr'] + np.median(dist_to(curves[fr + 'o'])[sel] - gaps['gr']))
    for i in range(3):
        sel = (a == keys.index(f'ge{i}')) & ok
        if sel.sum() > 10:
            cx, cy, r = circ[f'e{i}']
            gaps['ge'][i] = float(np.median(np.hypot(P[sel, 0] - cx, P[sel, 1] - cy)) - r)
    print(it, {k: round(v, 2) if isinstance(v, float) else [round(x, 2) for x in v] for k, v in gaps.items()})


def fill(poly):
    im = np.zeros((1080, 1080), np.uint8)
    cv2.fillPoly(im, [np.round((poly - 0.5) * 16).astype(np.int32)], 1, lineType=cv2.LINE_8, shift=4)
    return im.astype(bool)


def render():
    f = front; b = 'A' if f == 'B' else 'B'
    cv_ = {k: curve_poly(v) for k, v in C.items()}
    ring = {R: fill(cv_[R + 'o']) & ~fill(cv_[R + 'i']) for R in 'AB'}
    grown = fill(offset(cv_[f + 'o'], gaps['gr'])) & ~fill(offset(cv_[f + 'i'], -gaps['gr']))
    img = (ring[b] & ~grown) | ring[f]
    for i in range(3):
        cx, cy, r = circ[f'e{i}']
        img &= ~fill(circ_poly(cx, cy, r + gaps['ge'][i])); img |= fill(circ_poly(cx, cy, r))
    img |= fill(circ_poly(*circ['n']))
    return img


tb = F > 0.5
r = render(); print('K', K, 'LAM', LAM, 'IoU', round(float((r & tb).sum() / (r | tb).sum()), 4))
json.dump({'blue': d['blue'], 'front': front, 'curves': C, 'circles': circ, 'gaps': gaps}, open(S + 'atom-four.json', 'w'), indent=1)
o = np.zeros((1080, 1080, 3), np.uint8); o[tb & r] = (200, 200, 200); o[tb & ~r] = (0, 0, 255); o[r & ~tb] = (0, 255, 0)
cv2.imwrite(S + 'diff.png', o)
