import type { WebContext } from "./context";
import { quoteCoins } from "@/domain/quotes";

/** USD per whole token: launched tokens from their last indexed trade, every other mint from Jupiter (local quote stand-ins via their mainnet mint). */
export async function usdPrices(ctx: WebContext, mints: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(mints)];
  if (unique.length === 0) return {};
  const launched = await ctx.sql`
    select l.mint, t.price * t.quote_usd as usd from launches l
    join lateral (select price, quote_usd from trades where launch_id = l.id order by slot desc, seq desc limit 1) t on true
    where l.mint in ${ctx.sql(unique)}`;
  const out: Record<string, number | null> = Object.fromEntries(launched.map((r: any) => [r.mint, r.usd]));
  const known = new Set(launched.map((r: any) => r.mint));
  const quotes = new Map(quoteCoins().map((q) => [q.mint, q]));
  const rest = unique.filter((m) => !known.has(m) && !quotes.get(m)?.platform);
  const lookup = rest.map((m) => quotes.get(m)?.iconMint ?? m);
  const found = lookup.length ? await ctx.prices.usdMany(lookup) : {};
  rest.forEach((m, i) => { out[m] = found[lookup[i]!] ?? null; });
  for (const m of unique) if (!(m in out)) out[m] = null;
  return out;
}
