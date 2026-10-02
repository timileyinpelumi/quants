# Brand sources

- `build.py` writes `public/brand/quants-mark.svg`, `quants-icon.svg`, `quants-logo.svg` (light text, for dark backgrounds), `quants-logo-dark.svg` (dark text, for light backgrounds) and `src/app/icon.svg` from `atom.json` and `word.json`. Run `python3 brand-src/build.py`. With a directory argument it writes the same files there for review instead.
- `render.cjs` renders the PNGs from those SVGs with Chrome: `public/brand/quants-mark-512.png`, `quants-mark-1024.png`, `quants-logo-512h.png`, `quants-logo-dark-512h.png` and `src/app/apple-icon.png`. Run `node brand-src/render.cjs` from the repo root after `build.py`.
- `atom.json` is the mark traced from the 1080 by 1080 reference artwork. To trace it again, run in order (needs numpy and opencv): `python3 brand-src/trace.py ref.png` (circles and plain ellipses fitted by pixel error), `python3 brand-src/refine.py ref.png` (each ring edge refitted as an ellipse plus a Fourier series in radius), `python3 brand-src/polish.py ref.png` (final nudges against the antialiased edges; writes `atom.json`). Intermediate files go to `brand-src/.fit`, which is not committed.
- The wordmark is Bricolage Grotesque ExtraBold (wght 800, opsz 48), the same family as the site headings, outlined into `word.json`. `outline.py` regenerates it if the wordmark changes. It needs `fonttools` and a static instance of the variable font: `fonttools varLib.instancer "BricolageGrotesque[opsz,wdth,wght].ttf" wght=800 opsz=48 wdth=100 -o Bricolage-ExtraBold.ttf`, then `python3 brand-src/outline.py Bricolage-ExtraBold.ttf`.

Mark: a blue atom on a black square. A solid nucleus, two crossed orbit rings that taper (thick at the ends of each ellipse, thin along the sides), one steep and one shallow, and three electrons on the rings. Small gaps separate the rings where they cross and where they meet the electrons. The gaps are masks, so on the lockups they show whatever is behind, not black.

`quants-mark.svg` keeps the artwork's own margins. `quants-icon.svg` and `src/app/icon.svg` crop the margins and widen the gaps a little so the mark reads at 16 to 64px; the header, footer and favicon use it.

Colours: blue `#1896FD`, tile `#000000`, light ink `#F4F2EE`, dark ink `#0A0A0F`.
