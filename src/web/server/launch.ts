import { z } from "zod";
import type { WebContext } from "./context";
import { prepareLaunch, LaunchError } from "@/launch/prepare";
import { loadLatestSettings } from "@/domain/settings";
import { NATIVE_MINT } from "@/domain/types";
import { allQuotes, launchableQuotes } from "./quotes";
import { resolveConfig, seedConfigKeys } from "@/launch/config-keys";
import { keeperTopUp } from "./keeper-topup";
import { checkTx, walletTx, type WalletTx } from "./tx-check";

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
  /** Pair token base units an earlier swap step bought for the first buy; when set no swap is built again. */
  quoteBought: z.string().regex(/^\d+$/, "Bought amount must be a whole number").optional(),
  quoteMint: z.string(),
  creator: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Creator wallet address is not valid"),
  basket: z.array(z.object({ mint: z.string() }).passthrough()).max(10).default([]),
}).passthrough();

export type LaunchStep =
  | { step: "config"; transaction: WalletTx }
  | { step: "swap"; transaction: WalletTx; quoteBought: string }
  | { step: "launch"; transaction: WalletTx; mint: string; pool: string; settingsVersion: number };

/**
 * One wallet prompt per call, in order: create the config key when the pair and fee have none yet, swap SOL to the
 * pair token for a first buy in a pair other than SOL, then the launch. The client calls again after each step
 * confirmed (with `quoteBought` after the swap), so every transaction is built and simulated against current state.
 * A first buy in a pair other than SOL is capped at the swap's slippage floor.
 */
export async function prepareWithSwap(ctx: WebContext, raw: unknown): Promise<LaunchStep> {
  const { devBuySol, quoteBought, ...rest } = Body.parse(raw);
  const prefix = ctx.uploadPrefix;
  for (const [field, label] of [["uri", "Metadata"], ["image", "Image"]] as const) {
    const v = (rest as Record<string, unknown>)[field];
    if (prefix && v !== undefined && (typeof v !== "string" || !v.startsWith(prefix))) {
      throw new LaunchError("invalid_input", `${label} must be uploaded through quants. Upload the image again.`);
    }
  }
  const { slippageBps, launchesPaused } = await loadLatestSettings(ctx.sql);
  if (launchesPaused) throw new LaunchError("launches_paused", "New launches are paused for now. Trading and staking carry on as normal. Try again later.");
  // Labels and decimals shown to stakers come from Jupiter's verified list, never from the request.
  rest.basket = await Promise.all(rest.basket.map(async (b) => {
    const t = (await ctx.jupiter.searchVerified(b.mint)).find((x) => x.mint === b.mint);
    return { ...b, symbol: t?.symbol, decimals: t?.decimals };
  }));
  const sol = BigInt(devBuySol);
  const paired = rest.quoteMint !== NATIVE_MINT;
  const swap = paired && sol > 0n && quoteBought === undefined
    ? await ctx.jupiter.quote(NATIVE_MINT, rest.quoteMint, sol, slippageBps)
    : undefined;
  if (swap === null) throw new LaunchError("invalid_input", "No route to buy the pair token right now. Try again, or launch without a first buy.");
  const devBuyQuoteAmount = !paired ? sol : swap ? (swap.outAmount * BigInt(10_000 - slippageBps)) / 10_000n : BigInt(quoteBought ?? "0");
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
    { stopBeforeLaunch: swap !== undefined },
  );
  if (p.step === "config") {
    // Optional: when another launch created the same config key first, this one fails and the launch goes on.
    const transaction = walletTx(p.transaction, { optional: true });
    await checkTx(ctx.conn, transaction);
    return { step: "config", transaction };
  }
  if (p.step === "ready") {
    if (!swap) throw new Error("ready without a swap");
    const transaction: WalletTx = { base64: (await ctx.jupiter.buildUnsignedSwap(swap, rest.creator)).base64, versioned: true };
    await checkTx(ctx.conn, transaction);
    return { step: "swap", transaction, quoteBought: devBuyQuoteAmount.toString() };
  }
  const transaction = walletTx(p.transaction);
  await checkTx(ctx.conn, transaction);
  return { step: "launch", transaction, mint: p.mint, pool: p.pool, settingsVersion: p.settingsVersion };
}
