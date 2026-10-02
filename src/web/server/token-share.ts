import type { SQL } from "bun";
import { fmtChange, fmtCompact, fmtPrice } from "@/web/ui/format";
import { market } from "./chart";

export type TokenShare = {
  mint: string; symbol: string; name: string | null; tradingOnly: boolean;
  priceUsd: number | null; mcapUsd: number | null; change24h: number | null;
};

/** What a shared link previews: the token and its market, when it has traded. */
export async function tokenShare(sql: SQL, mint: string, now = Date.now()): Promise<TokenShare | null> {
  const [l] = await sql`select id, mint, coalesce(symbol, left(mint, 4)) as symbol, name, trading_only from launches where mint = ${mint}`;
  if (!l) return null;
  const m = await market(sql, Number(l.id), now);
  return {
    mint: l.mint, symbol: l.symbol, name: l.name, tradingOnly: l.trading_only === true,
    priceUsd: m?.priceUsd ?? null, mcapUsd: m?.fdvUsd ?? null, change24h: m ? m.change24h : null,
  };
}

export function shareDescription(t: TokenShare): string {
  const facts = [
    t.priceUsd !== null && `Price $${fmtPrice(t.priceUsd)}`,
    t.mcapUsd !== null && `market cap $${fmtCompact(t.mcapUsd)}`,
    t.change24h !== null && `${fmtChange(t.change24h)} in 24h`,
  ].filter(Boolean);
  const lead = `${t.name ? `${t.name} (${t.symbol})` : t.symbol} on quants.`;
  const tail = t.tradingOnly ? "Trade it on quants." : "Trading fees pay its stakers.";
  return [lead, facts.length ? `${facts.join(", ")}.` : "No trades yet.", tail].join(" ");
}
