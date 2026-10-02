# Step 3: nudges every parameter against the antialiased reference and writes brand-src/atom.json.
# Usage: python3 brand-src/polish.py reference.png [start.json] [rounds] [steps]
import json, sys, time, numpy as np, cv2
import os
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.fit') + '/'
os.makedirs(S, exist_ok=True)
im = cv2.imread(sys.argv[1])
F = np.clip(im[..., 0].astype(np.float32) / 253.0, 0, 1)
tb = F > 0.5
src = sys.argv[2] if len(sys.argv) > 2 else S + 'atom-four.json'
M = json.load(open(src))
front = M['front']


def rell(th, a, b, t):
    q = th - np.radians(t)
    return 1 / np.sqrt((np.cos(q) / a) ** 2 + (np.sin(q) / b) ** 2)


def basis(t, k):
    cols = [np.ones_like(t)]
    for j in range(1, k + 1): cols += [np.cos(j * t), np.sin(j * t)]
    return np.stack(cols, 1)


T = np.linspace(0, 2 * np.pi, 1440, endpoint=False)
BASIS = {}


def curve_poly(c):
    k = (len(c['coef']) - 1) // 2
    if k not in BASIS: BASIS[k] = basis(T, k)
    r = BASIS[k] @ np.array(c['coef']) + rell(T, c['a'], c['b'], c['t'])
    return np.c_[c['cx'] + r * np.cos(T), c['cy'] + r * np.sin(T)]


def circ_poly(cx, cy, r):
    t = T[::2]
    return np.c_[cx + r * np.cos(t), cy + r * np.sin(t)]


def offset(poly, g):
    d = np.roll(poly, -1, 0) - np.roll(poly, 1, 0)
    n = np.c_[d[:, 1], -d[:, 0]]; n /= np.linalg.norm(n, axis=1, keepdims=True)
    if ((poly - poly.mean(0)) * n).sum() < 0: n = -n
    return poly + g * n


def fill(poly):
    o = np.zeros((1080, 1080), np.uint8)
    cv2.fillPoly(o, [np.round((poly - 0.5) * 16).astype(np.int32)], 1, lineType=cv2.LINE_8, shift=4)
    return o.astype(bool)


def render(M):
    C, circ, gaps = M['curves'], M['circles'], M['gaps']
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


def err(M):
    return int((render(M) ^ tb).sum())


def params(M):
    out = []
    for k, c in M['curves'].items():
        for f in ['cx', 'cy', 'a', 'b', 't']: out.append(('curves', k, f, None))
        for j in range(len(c['coef'])): out.append(('curves', k, 'coef', j))
    for k in M['circles']:
        for j in range(3): out.append(('circles', k, None, j))
    out.append(('gaps', 'gr', None, None))
    for j in range(3): out.append(('gaps', 'ge', None, j))
    return out


def get(M, q):
    s, k, f, j = q
    v = M[s][k]
    if f is not None: v = v[f]
    return v if j is None else v[j]


def put(M, q, val):
    s, k, f, j = q
    if s == 'gaps' and j is None: M[s][k] = val; return
    if f is None: M[s][k][j] = val; return
    if j is None: M[s][k][f] = val
    else: M[s][k][f][j] = val


best = err(M)
tb_sum = tb.sum()
print('start', best, flush=True)
for st in [float(x) for x in (sys.argv[4] if len(sys.argv) > 4 else "1,0.5,0.25").split(",")]:
    for rnd in range(int(sys.argv[3]) if len(sys.argv) > 3 else 6):
        t0 = time.time(); better = 0
        for q in params(M):
            d = st * (0.5 if q[2] == 't' else 1)
            v = get(M, q)
            for sgn in (1, -1):
                put(M, q, v + sgn * d)
                e = err(M)
                if e < best: best = e; better += 1; break
                put(M, q, v)
        r = render(M)
        print(st, rnd, best, 'IoU', round(float((r & tb).sum() / (r | tb).sum()), 4), better, round(time.time() - t0), flush=True)
        json.dump(M, open(os.path.join(os.path.dirname(S[:-1]), 'atom.json'), 'w'), indent=1)
        if not better: break
