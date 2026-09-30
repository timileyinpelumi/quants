import json
d = json.load(open("glyphs.json"))
q, word = d["q"], d["word"]
qx0, qy0, qx1, qy1 = d["qb"]; wx0, wy0, wx1, wy1 = d["wb"]
s = 66 / (qy1 - qy0)
qcx, qcy = (qx0 + qx1) / 2, (qy0 + qy1) / 2

def mark(ox=0, oy=0, gid="m"):
    return f'''<g transform="translate({ox} {oy})">
  <defs><linearGradient id="{gid}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DBFF72"/><stop offset="1" stop-color="#C8FF3D"/></linearGradient></defs>
  <rect width="128" height="128" rx="40" fill="#8FBF16"/>
  <rect width="128" height="119" rx="40" fill="url(#{gid}f)"/>
  <g transform="translate(52 58) scale({s:.4f}) translate({-qcx:.2f} {-qcy:.2f})"><path d="{q}" fill="#0A0A0F"/></g>
  <circle cx="103" cy="38" r="7" fill="#8B7BFF"/>
  <circle cx="103" cy="58" r="7" fill="#FF7A59"/>
  <circle cx="103" cy="78" r="7" fill="#4FB8FF"/>
</g>'''

def logo(fill):
    ws = 0.8
    ty = 64 - ((wy0 + wy1) / 2) * ws
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {128 + 32 + (wx1 - wx0) * 0.8 + 4:.0f} 128" role="img" aria-label="quants">
{mark(gid="l")}
<g transform="translate({128 + 32 - wx0 * ws:.2f} {ty:.2f}) scale({ws})"><path d="{word}" fill="{fill}"/></g>
</svg>
'''

open("quants-mark.svg", "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="quants">\n{mark()}\n</svg>\n')
open("quants-logo.svg", "w").write(logo("#F4F2EE"))
open("quants-logo-dark.svg", "w").write(logo("#0A0A0F"))
