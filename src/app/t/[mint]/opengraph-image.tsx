import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getContext } from "@/web/server/context";
import { tokenShare } from "@/web/server/token-share";
import { fmtChange, fmtCompact, fmtPrice } from "@/web/ui/format";

export const alt = "Token on quants";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const INK = "#F4F2EE", MUTED = "#9A97A8", BLUE = "#4C9DFF", UP = "#2EBD85", DOWN = "#F6465D";

export default async function Image({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const [t, mark] = await Promise.all([
    tokenShare(getContext().sql, mint).catch(() => null),
    readFile(join(process.cwd(), "public/brand/quants-mark.svg"), "utf8"),
  ]);
  const markSrc = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;
  const symbol = t?.symbol ?? "quants";
  const change = t?.change24h ?? null;
  const tone = change === null ? MUTED : Math.round(change * 10) / 10 > 0 ? UP : Math.round(change * 10) / 10 < 0 ? DOWN : MUTED;
  const stats: [string, string, string][] = t ? [
    ["Price", t.priceUsd === null ? "No trades" : `$${fmtPrice(t.priceUsd)}`, INK],
    ["Market cap", t.mcapUsd === null ? "No trades" : `$${fmtCompact(t.mcapUsd)}`, INK],
    ["24h", change === null ? "0%" : fmtChange(change), tone],
  ] : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0A0A0F", color: INK, padding: "64px 72px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <img src={markSrc} width={84} height={84} style={{ borderRadius: 20 }} />
            <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>quants</span>
          </div>
          {t && !t.tradingOnly && <span style={{ fontSize: 26, color: MUTED }}>Trading fees pay its stakers</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 72 }}>
          <span style={{ fontSize: 132, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>{symbol.slice(0, 12)}</span>
          {t?.name && <span style={{ fontSize: 40, color: MUTED, marginTop: 14 }}>{t.name.slice(0, 40)}</span>}
        </div>
        <div style={{ display: "flex", gap: 80, marginTop: "auto", borderTop: "2px solid rgba(255,255,255,0.1)", paddingTop: 36 }}>
          {stats.map(([label, value, color]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 26, color: MUTED }}>{label}</span>
              <span style={{ fontSize: 54, fontWeight: 700, color }}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, background: BLUE, display: "flex" }} />
      </div>
    ),
    size,
  );
}
