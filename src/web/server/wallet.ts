import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { z } from "zod";
import type { WebContext } from "./context";
import { iconsFor } from "./icons";
import { quoteCoin, quoteCoins } from "@/domain/quotes";
import { NATIVE_MINT } from "@/domain/types";

export interface HeldToken { mint: string; amount: string; decimals: number; symbol: string | null; name: string | null; image: string | null; kind: "launch" | "platform" | "reward" | "other" }
const RANK = { launch: 0, platform: 1, reward: 2, other: 3 } as const;

export async function walletOverview(ctx: WebContext, ownerRaw: string) {
  const owner = new PublicKey(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Wallet address is not valid").parse(ownerRaw));
  const [sol, accounts] = await Promise.all([
    ctx.conn.getBalance(owner, "confirmed"),
    ctx.conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
  ]);
  const held = new Map<string, { amount: bigint; decimals: number }>();
  for (const a of accounts.value) {
    const info = (a.account.data as any).parsed.info;
    const prev = held.get(info.mint);
    const amount = BigInt(info.tokenAmount.amount) + (prev?.amount ?? 0n);
    held.set(info.mint, { amount, decimals: info.tokenAmount.decimals });
  }
  const mints = [...held.keys()];
  const launches = mints.length ? await ctx.sql`select mint, symbol, name, image from launches where mint in ${ctx.sql(mints)}` : [];
  const rewards = mints.length ? await ctx.sql`select distinct on (reward_mint) reward_mint, symbol from baskets where reward_mint in ${ctx.sql(mints)} and symbol is not null` : [];
  const lmap = new Map(launches.map((l: any) => [l.mint, l]));
  const rmap = new Map(rewards.map((r: any) => [r.reward_mint, r.symbol as string]));
  const quotes = quoteCoins();
  const icons = await iconsFor(ctx.icons, [NATIVE_MINT, ...mints.filter((m) => !lmap.has(m))], quotes).catch(() => ({} as Record<string, string | null>));
  const tokens: HeldToken[] = [];
  for (const [mint, h] of held) {
    if (h.amount === 0n) continue;
    const l = lmap.get(mint) as any;
    const kind: HeldToken["kind"] = l ? "launch" : mint === ctx.ourtokenMint ? "platform" : rmap.has(mint) ? "reward" : "other";
    tokens.push({
      mint, amount: h.amount.toString(), decimals: h.decimals, kind, image: l?.image ?? icons[mint] ?? null, name: l?.name ?? null,
      symbol: l?.symbol ?? quoteCoin(mint, quotes)?.symbol ?? rmap.get(mint) ?? null,
    });
  }
  tokens.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.symbol ?? "~").localeCompare(b.symbol ?? "~"));
  return { sol: String(sol), solIcon: icons[NATIVE_MINT] ?? null, tokens };
}
