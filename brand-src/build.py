# Writes the mark, both logo lockups and the app icon. The mark is drawn from shapes, so it needs no font;
# the wordmark path (Unbounded Black) is kept in word.json, made once with outline.py.
import json, os
here = os.path.dirname(os.path.abspath(__file__))
word = json.load(open(os.path.join(here, "word.json")))

def mark(gid="m"):
    return f'''<g>
  <defs><linearGradient id="{gid}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D1C27"/><stop offset="1" stop-color="#0E0D14"/></linearGradient></defs>
  <rect width="128" height="128" rx="36" fill="url(#{gid}t)"/>
  <rect x="1" y="1" width="126" height="126" rx="35" fill="none" stroke="#FFFFFF" stroke-opacity="0.09" stroke-width="2"/>
  <circle cx="57" cy="60" r="25.5" fill="none" stroke="#4C9DFF" stroke-width="17"/>
  <path d="M74 60 H91 V97 L74 107 Z" fill="#4C9DFF"/>
  <circle cx="57" cy="60" r="7" fill="#9D8CFF"/>
  <circle cx="96" cy="27" r="5.5" fill="#9D8CFF"/>
  <circle cx="107.5" cy="39" r="4" fill="#FF7A59"/>
  <circle cx="113" cy="53.5" r="3" fill="#4FB8FF"/>
</g>'''

def logo(fill):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{word["viewBox"]}" role="img" aria-label="quants">
{mark("l")}
<g transform="{word["transform"]}"><path d="{word["path"]}" fill="{fill}"/></g>
</svg>
'''

out = os.path.join(here, "..", "public", "brand")
mark_svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="quants">\n{mark()}\n</svg>\n'
open(os.path.join(out, "quants-mark.svg"), "w").write(mark_svg)
open(os.path.join(here, "..", "src", "app", "icon.svg"), "w").write(mark_svg)
open(os.path.join(out, "quants-logo.svg"), "w").write(logo("#F4F2EE"))
open(os.path.join(out, "quants-logo-dark.svg"), "w").write(logo("#0A0A0F"))
