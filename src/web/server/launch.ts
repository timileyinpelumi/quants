import { z } from "zod";
import type { WebContext } from "./context";
import { prepareLaunch, LaunchError } from "@/launch/prepare";
import { loadLatestSettings } from "@/domain/settings";
import { NATIVE_MINT } from "@/domain/types";
import { allQuotes, launchableQuotes } from "./quotes";
import { resolveConfig, seedConfigKeys } from "@/launch/config-keys";
import { keeperTopUp } from "./keeper-topup";

const g = globalThis as { __quantsConfigSeed?: Promise<number> };

// Config keys from CONFIG_KEYS or config-keys.json are recorded once per process, so launches reuse them.
export const resetConfigSeed = () => { g.__quantsConfigSeed = undefined; };

function seedOnce(ctx: WebContext) {
  g.__quantsConfigSeed ??= seedConfigKeys(ctx.sql, ctx.meteora, ctx.configKeys).catch((e) => {
    g.__quantsConfigSeed = undefined;
    console.error(JSON.stringify({ at: new Date().toISOString(), configSeedFailed: String(e) }));
    return 0;
  });
  return g.__quantsConfigSeed;
}

const Body = z.object({
  devBuySol: z.string().regex(/^\d+$/, "First buy must be a whole number of lamports").default("0"),
  quoteMint: z.string(),
  creator: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Creator wallet address is not valid"),
  basket: z.array(z.object({ mint: z.string() }).passthrough()).max(10).default([]),
}).passthrough();

/** `optional`: the launch goes on if it fails (a config key another launch created first). */
export type UnsignedTx = { base64: string; versioned: boolean; optional?: boolean };

// A first buy in any pair token other than SOL is paid in SOL: a Jupiter swap runs first and the curve buy is capped at the swap's slippage floor.
export async function prepareWithSwap(ctx: WebContext, raw: unknown) {
  const { devBuySol, ...rest } = Body.parse(raw);
  const { slippageBps, launchesPaused } = await loadLatestSettings(ctx.sql);
  if (launchesPaused) throw new LaunchError("launches_paused", "New launches are paused for now. Trading and staking carry on as normal. Try again later.");
  // Labels and decimals shown to stakers come from Jupiter's verified list, never from the request.
  rest.basket = await Promise.all(rest.basket.map(async (b) => {
    const t = (await ctx.jupiter.searchVerified(b.mint)).find((x) => x.mint === b.mint);
    return { ...b, symbol: t?.symbol, decimals: t?.decimals };
  }));
  const sol = BigInt(devBuySol);
  const transactions: UnsignedTx[] = [];
  let devBuyQuoteAmount = sol;
  if (rest.quoteMint !== NATIVE_MINT && sol > 0n) {
    const q = await ctx.jupiter.quote(NATIVE_MINT, rest.quoteMint, sol, slippageBps);
    if (!q) throw new LaunchError("invalid_input", "No route to buy the pair token right now. Try again, or launch without a first buy.");
    devBuyQuoteAmount = (q.outAmount * BigInt(10_000 - slippageBps)) / 10_000n;
    transactions.push({ base64: (await ctx.jupiter.buildUnsignedSwap(q, rest.creator)).base64, versioned: true });
  }
  const quotes = await allQuotes(ctx);
  const launchable = await launchableQuotes(ctx, quotes);
  await seedOnce(ctx);
  const p = await prepareLaunch(
    {
      sql: ctx.sql, meteora: ctx.meteora, quoteMints: launchable.map((c) => c.mint),
      configFor: async (mint, fee) => {
        const coin = launchable.find((c) => c.mint === mint);
        return coin ? resolveConfig({ sql: ctx.sql, meteora: ctx.meteora, keeper: ctx.keeperAddress }, coin, fee) : null;
      },
      keeperTopUp: () => keeperTopUp(ctx),
      tradingOnlyMints: quotes.filter((c) => c.tradingOnly).map((c) => c.mint),
      isVerified: (m) => ctx.jupiter.isVerified(m), tokenProgramOf: ctx.tokenProgramOf,
    },
    { ...rest, devBuyQuoteAmount: devBuyQuoteAmount.toString(), devBuyMinOut: "0" },
  );
  if (p.setupTransaction) transactions.unshift({ base64: p.setupTransaction, versioned: false, optional: true });
  transactions.push({ base64: p.transaction, versioned: false });
  return { mint: p.mint, pool: p.pool, settingsVersion: p.settingsVersion, transactions };
}
