# Brand sources

- `outline.py` turns "quants" and "q" in Unbounded Black (wght 900) into SVG paths (`glyphs.json`). Needs `fonttools` and the Unbounded variable font from google/fonts, instanced with `fonttools varLib.instancer Unbounded.ttf wght=900`.
- `build.py` writes `quants-mark.svg`, `quants-logo.svg` (light text, for dark backgrounds) and `quants-logo-dark.svg` (dark text, for light backgrounds).
- PNGs in `public/brand` are rendered from the SVGs with Chrome.

Mark: lime tile with a heavy "q" and three dots for the three reward tokens. Colours: lime `#C8FF3D` (tile), `#8FBF16` (tile edge), ink `#0A0A0F`, violet `#8B7BFF`, orange `#FF7A59`, sky `#4FB8FF`.
