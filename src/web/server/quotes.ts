import type { WebContext } from "./context";
import { quoteCoins, stockQuotes, type QuoteCoin } from "@/domain/quotes";
import { iconsFor } from "./icons";

/** Crypto pairs and approved stock pairs; if the stock registry fails, the last stock list this process loaded. */
export async function allQuotes(ctx: Pick<WebContext, "stocks">): Promise<QuoteCoin[]> {
  const stocks = await ctx.stocks.list().catch((e) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), stocksFailed: String(e) }));
    return stockQuotes();
  });
  return [...quoteCoins(), ...stocks];
}

/** Pairs whose curve configs exist on this network, so a launch against them can be built. */
export async function launchableQuotes(ctx: Pick<WebContext, "stocks" | "configKeys">): Promise<QuoteCoin[]> {
  const keyed = new Set(Object.keys(ctx.configKeys).map((k) => k.split(":")[0]));
  return (await allQuotes(ctx)).filter((c) => keyed.has(c.mint));
}

/** Jupiter logos first; a stock Jupiter has no logo for falls back to its issuer's. */
export async function quoteIcons(ctx: Pick<WebContext, "icons" | "stocks">, mints: string[], quotes: QuoteCoin[]) {
  const icons = await iconsFor(ctx.icons, mints, quotes);
  const missing = mints.filter((m) => !icons[m] && quotes.some((q) => q.mint === m && q.tradingOnly));
  if (missing.length) {
    const issuer = await ctx.stocks.icons(missing).catch(() => ({} as Record<string, string | null>));
    for (const m of missing) icons[m] = issuer[m] ?? null;
  }
  return icons;
}
