# Brand sources

- `build.py` writes `public/brand/quants-mark.svg`, `quants-logo.svg` (light text, for dark backgrounds), `quants-logo-dark.svg` (dark text, for light backgrounds) and `src/app/icon.svg`. Run `python3 brand-src/build.py`.
- The mark is drawn from shapes and needs no font. The wordmark path (Unbounded Black, wght 900) is stored in `word.json`; `outline.py` regenerates it from the font if the wordmark ever changes. It needs `fonttools` and the Unbounded variable font instanced with `fonttools varLib.instancer Unbounded.ttf wght=900`.
- PNGs in `public/brand` and `src/app/apple-icon.png` are rendered from the SVGs with Chrome.

Mark: a dark tile with a lime "q". The violet coin in its centre is the launched token; the three dots leaving it are the reward tokens paid to stakers.
Colours: lime `#C8FF3D`, tile `#1D1C27` to `#0E0D14`, ink `#0A0A0F`, violet `#9D8CFF`, orange `#FF7A59`, sky `#4FB8FF`.
