// Renders the brand PNGs from the SVGs that build.py writes. Run from the repo root: node brand-src/render.cjs
const fs = require("fs");
const { chromium } = require("playwright");

const svg = (f) => fs.readFileSync(f, "utf8");
const uri = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;
const mark = svg("public/brand/quants-mark.svg");
const icon = svg("src/app/icon.svg");

const jobs = [
  { src: mark, w: 512, h: 512, out: "public/brand/quants-mark-512.png" },
  { src: mark, w: 1024, h: 1024, out: "public/brand/quants-mark-1024.png" },
  // The tile is already full bleed and square, which is what iOS expects before it rounds the corners.
  { src: icon, w: 180, h: 180, out: "src/app/apple-icon.png" },
  ...["", "-dark"].map((v) => {
    const s = svg(`public/brand/quants-logo${v}.svg`);
    const [, vw, vh] = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(s);
    return { src: s, w: Math.round((512 * vw) / vh), h: 512, out: `public/brand/quants-logo${v}-512h.png` };
  }),
];

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.w, height: j.h } });
    await page.setContent(`<body style="margin:0;background:transparent"><img src="${uri(j.src)}" width="${j.w}" height="${j.h}" style="display:block"></body>`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: j.out, omitBackground: true, clip: { x: 0, y: 0, width: j.w, height: j.h } });
    console.log(j.out, j.w, j.h);
  }
  await browser.close();
})();
