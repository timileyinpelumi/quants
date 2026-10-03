import { z } from "zod";
import type { WebContext } from "./context";
import { LaunchError } from "@/launch/prepare";
import { thresholdOf } from "@/launch/config-keys";
import { configKeyName } from "@/meteora/config";
import { firstBuyOut } from "@/meteora/first-buy";
import { cachedSettings } from "@/domain/settings";
import { NATIVE_MINT } from "@/domain/types";
import { ttlCache } from "@/domain/lru";
import type { QuoteCoin } from "@/domain/quotes";
import { allQuotes, launchableQuotes } from "./quotes";

const SUPPLY_BASE_UNITS = 1_000_000_000n * 1_000_000n;

const Query = z.object({
  quoteMint: z.string().min(32).max(44),
  fee: z.coerce.number().int().positive(),
  sol: z.string().regex(/^\d{1,16}$/, "First buy must be a whole number of lamports"),
});

export type FirstBuyEstimate = {
  /** Base units of the new token (6 decimals), or null when the buy is larger than the whole curve or has no route. */
  tokens: string | null;
  /** Pair token base units that reach the curve. */
  quoteAmount: string | null;
  overCap: boolean;
};

// Each estimate holds a Jupiter quote for non SOL pairs; a few seconds of reuse spares Jupiter repeat keystrokes.
const cache = ttlCache<FirstBuyEstimate>(10_000, 2_000);
export const resetFirstBuyCache = () => cache.clear();

/** The config key a launch on this pair and fee would use now, if it is on chain already. */
async function liveConfig(ctx: Pick<WebContext, "sql" | "configKeys">, coin: QuoteCoin, fee: number): Promise<string | null> {
  if (coin.tradingOnly) {
    const [row] = await ctx.sql`select address from config_keys where quote_mint = ${coin.mint} and fee_bps = ${fee} and status = 'live' order by created_at limit 1`;
    return row?.address ?? ctx.configKeys[configKeyName(coin.mint, fee)] ?? null;
  }
  const threshold = thresholdOf(coin.graduation, coin.decimals);
  const [row] = await ctx.sql`select address from config_keys where quote_mint = ${coin.mint} and fee_bps = ${fee} and threshold = ${threshold.toString()}::numeric and status = 'live'`;
  return row?.address ?? null;
}

/**
 * Tokens a first buy of `sol` lamports gets at launch: swapped to the pair token first for pairs other than SOL, at
 * the same slippage floor prepare uses, then bought on the curve the launch will be created from, after its fee.
 */
export async function firstBuyEstimate(ctx: WebContext, params: URLSearchParams): Promise<FirstBuyEstimate> {
  const q = Query.parse(Object.fromEntries(params));
  const sol = BigInt(q.sol);
  if (sol === 0n) return { tokens: "0", quoteAmount: "0", overCap: false };
  const s = await cachedSettings(ctx.sql);
  if (!s.feeTiersBps.includes(q.fee)) throw new LaunchError("invalid_input", "That trading fee is not offered");
  const coin = (await launchableQuotes(ctx, await allQuotes(ctx))).find((c) => c.mint === q.quoteMint);
  if (!coin) throw new LaunchError("invalid_input", "That pair token is not supported");
  return cache.get(`${coin.mint}:${coin.graduation}:${q.fee}:${sol}:${s.slippageBps}:${s.devBuyCapBps}`, async () => {
    let quoteAmount = sol;
    if (coin.mint !== NATIVE_MINT) {
      const swap = await ctx.jupiter.quote(NATIVE_MINT, coin.mint, sol, s.slippageBps).catch(() => null);
      if (!swap) return { tokens: null, quoteAmount: null, overCap: false };
      quoteAmount = (swap.outAmount * BigInt(10_000 - s.slippageBps)) / 10_000n;
    }
    const key = await liveConfig(ctx, coin, q.fee);
    if (!key && coin.tradingOnly) return { tokens: null, quoteAmount: quoteAmount.toString(), overCap: false };
    const cfg = await ctx.meteora.curveConfig(key ?? { feeBps: q.fee, quote: { mint: coin.mint, decimals: coin.decimals, migrationQuoteThreshold: coin.graduation } });
    const tokens = firstBuyOut(cfg, quoteAmount);
    const overCap = tokens === null || tokens * 10_000n > SUPPLY_BASE_UNITS * BigInt(s.devBuyCapBps);
    return { tokens: tokens?.toString() ?? null, quoteAmount: quoteAmount.toString(), overCap };
  });
}
