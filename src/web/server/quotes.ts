import type { WebContext } from "./context";
import { quoteCoins, stockQuotes, type QuoteCoin } from "@/domain/quotes";
import { cachedSettings } from "@/domain/settings";
import { iconsFor } from "./icons";

/** Crypto pairs and approved stock pairs; if the stock registry fails, the last stock list this process loaded. */
export async function allQuotes(ctx: Pick<WebContext, "stocks" | "sql">): Promise<QuoteCoin[]> {
  await cachedSettings(ctx.sql);
  const stocks = await ctx.stocks.list().catch((e) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), stocksFailed: String(e) }));
    return stockQuotes();
  });
  return [...quoteCoins(), ...stocks];
}

/** Pairs a new launch can use: crypto pairs enabled on the admin page (their config keys are created on demand), and stocks with config keys only while the stock pairs switch is on. */
export async function launchableQuotes(ctx: Pick<WebContext, "stocks" | "configKeys" | "sql">, quotes?: QuoteCoin[]): Promise<QuoteCoin[]> {
  const keyed = new Set(Object.keys(ctx.configKeys).map((k) => k.split(":")[0]));
  const { stockPairs } = await cachedSettings(ctx.sql);
  return (quotes ?? await allQuotes(ctx)).filter((c) => (c.tradingOnly ? stockPairs && keyed.has(c.mint) : c.enabled && c.graduation > 0));
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
