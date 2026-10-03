import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "quants: launch a token that pays its stakers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#F4F2EE", MUTED = "#9A97A8", BLUE = "#1896FD";

export default async function Image() {
  const [font, mark] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Bricolage-ExtraBold.ttf")),
    readFile(join(process.cwd(), "public/brand/quants-icon.svg"), "utf8"),
  ]);
  const markSrc = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;
  const D = { fontFamily: "Bricolage", fontWeight: 800 } as const;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", background: "#0A0A0F", color: INK, padding: "0 96px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <img src={markSrc} width={180} height={180} />
          <span style={{ ...D, fontSize: 168, letterSpacing: -6, lineHeight: 1 }}>quants</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 56 }}>
          <span style={{ ...D, fontSize: 56, letterSpacing: -1 }}>Launch a token that <span style={{ color: BLUE, marginLeft: 16 }}>pays its stakers.</span></span>
          <span style={{ fontSize: 32, color: MUTED, marginTop: 20 }}>Trading fees buy tokens and pay them to the people who stake.</span>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, background: BLUE, display: "flex" }} />
      </div>
    ),
    { ...size, fonts: [{ name: "Bricolage", data: font, weight: 800, style: "normal" }] },
  );
}
