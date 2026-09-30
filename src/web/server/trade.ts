import { z } from "zod";
import type { WebContext } from "./context";
import { LaunchError } from "@/launch/prepare";
import { NATIVE_MINT } from "@/domain/types";
import type { Side, TradeTarget } from "@/meteora/trade";

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Wallet address is not valid");
const amount = z.string().regex(/^\d+$/, "Amount must be a whole number of base units").refine((v) => BigInt(v) > 0n, "Enter an amount");
const side = z.enum(["buy", "sell"], { message: "Side must be buy or sell" });
const slippage = z.coerce.number().int().min(1, "Slippage is at least 0.01%").max(1_000, "Slippage is at most 10%").default(100);

const OURTOKEN_DECIMALS = Number(process.env.OURTOKEN_DECIMALS ?? 6);

async function target(ctx: WebContext, mint: string): Promise<TradeTarget> {
  const [l] = await ctx.sql`select mint, pool, damm_pool, status, quote_mint from launches where mint = ${mint}`;
  if (!l) throw new LaunchError("invalid_input", "No token here");
  return {
    pool: l.pool, dammPool: l.status === "graduated" ? l.damm_pool : null, baseMint: l.mint, quoteMint: l.quote_mint,
    baseDecimals: 6, quoteDecimals: l.quote_mint === NATIVE_MINT ? 9 : OURTOKEN_DECIMALS,
  };
}

export async function quoteTrade(ctx: WebContext, params: URLSearchParams) {
  const q = z.object({ mint: z.string().min(1), side, amount, slippageBps: slippage }).parse(Object.fromEntries(params));
  const t = await target(ctx, q.mint);
  try {
    return await ctx.trade.quote(t, q.side as Side, BigInt(q.amount), q.slippageBps);
  } catch (e) {
    if (e instanceof Error && e.message === "graduated") throw new LaunchError("invalid_input", "This token just graduated. Refresh the page to trade on its new pool.");
    throw e;
  }
}

export async function buildTrade(ctx: WebContext, raw: unknown) {
  const b = z.object({ mint: z.string().min(1), side, amount, minOut: z.string().regex(/^\d+$/), owner: addr }).parse(raw);
  const t = await target(ctx, b.mint);
  return ctx.trade.buildSwapTx(t, b.side as Side, BigInt(b.amount), BigInt(b.minOut), b.owner);
}
