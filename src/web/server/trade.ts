import { z } from "zod";
import type { WebContext } from "./context";
import { LaunchError } from "@/launch/prepare";
import { quoteCoin } from "@/domain/quotes";
import type { Side, TradeTarget } from "@/meteora/trade";

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Wallet address is not valid");
const amount = z.string().regex(/^\d+$/, "Amount must be a whole number of base units").refine((v) => BigInt(v) > 0n, "Enter an amount");
const side = z.enum(["buy", "sell"], { message: "Side must be buy or sell" });
const slippage = z.coerce.number().int().min(1, "Slippage is at least 0.01%").max(1_000, "Slippage is at most 10%").default(100);

async function target(ctx: WebContext, mint: string): Promise<TradeTarget> {
  const [l] = await ctx.sql`select mint, pool, damm_pool, status, quote_mint from launches where mint = ${mint}`;
  if (!l) throw new LaunchError("invalid_input", "No token here");
  return {
    pool: l.pool, dammPool: l.status === "graduated" ? l.damm_pool : null, baseMint: l.mint, quoteMint: l.quote_mint,
    baseDecimals: 6, quoteDecimals: quoteCoin(l.quote_mint)?.decimals ?? 6,
  };
}

export async function quoteTrade(ctx: WebContext, params: URLSearchParams) {
  const q = z.object({ mint: z.string().min(1), side, amount, slippageBps: slippage }).parse(Object.fromEntries(params));
  const t = await target(ctx, q.mint);
  return ctx.trade.quote(t, q.side as Side, BigInt(q.amount), q.slippageBps).catch(readable);
}

function readable(e: unknown): never {
  if (e instanceof Error && e.message === "graduated") throw new LaunchError("invalid_input", "This token just graduated. Refresh the page to trade on its new pool.");
  if (e instanceof Error && e.message === "graduating") throw new LaunchError("invalid_input", "This token filled its curve and is moving to its new pool. Trading opens again in a few minutes.");
  throw e;
}

export async function buildTrade(ctx: WebContext, raw: unknown) {
  const b = z.object({ mint: z.string().min(1), side, amount, minOut: z.string().regex(/^\d+$/), owner: addr }).parse(raw);
  const t = await target(ctx, b.mint);
  return ctx.trade.buildSwapTx(t, b.side as Side, BigInt(b.amount), BigInt(b.minOut), b.owner).catch(readable);
}
