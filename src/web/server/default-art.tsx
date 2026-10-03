import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PALETTES = [["#1896FD", "#7B5CFF"], ["#2EBD85", "#1896FD"], ["#FF7A59", "#FF3D8B"], ["#F5B83D", "#FF7A59"], ["#9D8CFF", "#3DD6F5"], ["#3DD6F5", "#2EBD85"], ["#FF3D8B", "#7B5CFF"], ["#F5B83D", "#2EBD85"]];

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The image a launch gets when its creator adds none: a gradient picked from the symbol with the symbol's first letters. */
export async function defaultArt(symbol: string): Promise<File> {
  const h = hash(symbol.toUpperCase());
  const [a, b] = PALETTES[h % PALETTES.length]!;
  const angle = (h >> 8) % 360;
  const letters = symbol.length <= 4 ? symbol.toUpperCase() : symbol.toUpperCase().slice(0, 2);
  const font = await readFile(join(process.cwd(), "assets/fonts/Bricolage-ExtraBold.ttf"));
  const res = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(${angle}deg, ${a}, ${b})` }}>
        <span style={{ fontFamily: "Bricolage", fontWeight: 800, fontSize: letters.length >= 4 ? 150 : letters.length === 3 ? 190 : 250, color: "rgba(255,255,255,0.95)", letterSpacing: -8 }}>{letters}</span>
      </div>
    ),
    { width: 512, height: 512, fonts: [{ name: "Bricolage", data: font, weight: 800, style: "normal" }] },
  );
  return new File([await res.arrayBuffer()], `${symbol}.png`, { type: "image/png" });
}
