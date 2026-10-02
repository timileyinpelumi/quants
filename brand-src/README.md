# Brand sources

- `build.py` writes `public/brand/quants-mark.svg`, `quants-logo.svg` (light text, for dark backgrounds), `quants-logo-dark.svg` (dark text, for light backgrounds) and `src/app/icon.svg`. Run `python3 brand-src/build.py`. With a directory argument it writes all three logo concepts there for review instead.
- `render.cjs` renders the PNGs from those SVGs with Chrome: `public/brand/quants-mark-512.png`, `quants-mark-1024.png`, `quants-logo-512h.png`, `quants-logo-dark-512h.png` and `src/app/apple-icon.png` (the tile edge to edge, since iOS rounds it). Run `node brand-src/render.cjs` from the repo root after `build.py`.
- The mark is drawn from shapes and needs no font. The wordmark is Bricolage Grotesque ExtraBold (wght 800, opsz 48), the same family as the site headings, outlined into `word.json`. `outline.py` regenerates it if the wordmark changes. It needs `fonttools` and a static instance of the variable font: `fonttools varLib.instancer "BricolageGrotesque[opsz,wdth,wght].ttf" wght=800 opsz=48 wdth=100 -o Bricolage-ExtraBold.ttf`, then `python3 brand-src/outline.py Bricolage-ExtraBold.ttf`.

Mark: a geometric lowercase q in blue on a flat dark tile. The bowl is a ring, the stem is square cut, and the foot of the stem is a separate square block. It reads at 16px as a q with a dot under it.
Colours: blue `#4C9DFF`, tile `#12121A` with a 10% white hairline, light ink `#F4F2EE`, dark ink `#0A0A0F`.
