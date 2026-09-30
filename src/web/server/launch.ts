import { z } from "zod";
import type { WebContext } from "./context";
import { prepareLaunch, LaunchError } from "@/launch/prepare";
import { loadLatestSettings } from "@/domain/settings";
import { NATIVE_MINT } from "@/domain/types";

const Body = z.object({
  devBuySol: z.string().regex(/^\d+$/, "First buy must be a whole number of lamports").default("0"),
  quoteMint: z.string(),
  creator: z.string(),
}).passthrough();

export type UnsignedTx = { base64: string; versioned: boolean };

// An OURTOKEN first buy is paid in SOL: a Jupiter swap runs first and the curve buy is capped at the swap's slippage floor.
export async function prepareWithSwap(ctx: WebContext, raw: unknown) {
  const { devBuySol, ...rest } = Body.parse(raw);
  const sol = BigInt(devBuySol);
  const transactions: UnsignedTx[] = [];
  let devBuyQuoteAmount = sol;
  if (rest.quoteMint === ctx.ourtokenMint && sol > 0n) {
    const { slippageBps } = await loadLatestSettings(ctx.sql);
    const q = await ctx.jupiter.quote(NATIVE_MINT, ctx.ourtokenMint, sol, slippageBps);
    if (!q) throw new LaunchError("invalid_input", "There is no route to buy the pair token right now. Try again or launch without a first buy.");
    devBuyQuoteAmount = (q.outAmount * BigInt(10_000 - slippageBps)) / 10_000n;
    transactions.push({ base64: (await ctx.jupiter.buildUnsignedSwap(q, rest.creator)).base64, versioned: true });
  }
  const p = await prepareLaunch(
    {
      sql: ctx.sql, meteora: ctx.meteora, configKeys: ctx.configKeys, ourtokenMint: ctx.ourtokenMint, keeperAddress: ctx.keeperAddress,
      isVerified: (m) => ctx.jupiter.isVerified(m), tokenProgramOf: ctx.tokenProgramOf,
    },
    { ...rest, devBuyQuoteAmount: devBuyQuoteAmount.toString(), devBuyMinOut: "0" },
  );
  transactions.push({ base64: p.transaction, versioned: false });
  return { mint: p.mint, pool: p.pool, settingsVersion: p.settingsVersion, transactions };
}
