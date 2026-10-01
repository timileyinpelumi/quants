import { PublicKey, type Connection } from "@solana/web3.js";
import { deriveDbcPoolAuthority, deriveDammV2PoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { WebContext } from "./context";
import { market, type Market } from "./chart";
import { recentTrades, type TradeRow } from "./landing";
import { stakingOpens, type StakingOpens } from "./reads";
import { activity, curveProgress, holders, topTraders, type Activity, type HolderChain, type Holders, type Trader } from "./live";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const LIVE_TTL = 2_000;
const HOLDERS_TTL = 30_000;

export type TokenLive = {
  status: string;
  market: Market | null;
  quoteUsd: number | null;
  curve: { reserve: string; threshold: string; progress: number } | null;
  trades: TradeRow[];
  activity: Activity[];
  traders: Trader[];
  holders: Holders | null;
  creator: string;
  staking: StakingOpens | null;
  at: number;
};

export class RpcHolderChain implements HolderChain {
  constructor(private conn: Connection, private tokensBase: string, private apiKey?: string) {}
  async largest(mint: string) {
    return (await this.conn.getTokenLargestAccounts(new PublicKey(mint), "confirmed")).value.map((a) => ({ address: a.address.toBase58(), amount: BigInt(a.amount) }));
  }
  async owners(accounts: string[]) {
    if (accounts.length === 0) return [];
    const res = await this.conn.getMultipleParsedAccounts(accounts.map((a) => new PublicKey(a)), { commitment: "confirmed" });
    return res.value.map((a) => (a && "parsed" in a.data ? (a.data.parsed.info.owner as string) : null));
  }
  async supply(mint: string) { return BigInt((await this.conn.getTokenSupply(new PublicKey(mint), "confirmed")).value.amount); }
  // Jupiter knows holder counts for mainnet tokens; a local validator is small enough to count token accounts directly.
  async count(mint: string) {
    try {
      const res = await fetch(`${this.tokensBase}/search?query=${mint}`, { headers: this.apiKey ? { "x-api-key": this.apiKey } : {}, signal: AbortSignal.timeout(4_000) });
      const t = res.ok ? ((await res.json()) as { id: string; holderCount?: number }[]).find((x) => x.id === mint) : undefined;
      if (t?.holderCount !== undefined) return t.holderCount;
    } catch { /* fall through */ }
    if (!/127\.0\.0\.1|localhost/.test(this.conn.rpcEndpoint)) return null;
    const accts = await this.conn.getProgramAccounts(TOKEN_PROGRAM, {
      filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }], dataSlice: { offset: 64, length: 8 },
    });
    return accts.filter((a) => a.account.data.readBigUInt64LE(0) > 0n).length;
  }
}

const g = globalThis as { __quantsLive?: Map<string, { at: number; value: Promise<TokenLive> }>; __quantsHolders?: Map<string, { at: number; value: Promise<Holders | null> }> };
const liveCache = (g.__quantsLive ??= new Map());
const holderCache = (g.__quantsHolders ??= new Map());

// Stale while revalidate: a viewer never waits on the chain once a token has been read, and waits at most HOLDERS_WAIT the first time.
const HOLDERS_WAIT = 400;

async function holdersFor(ctx: WebContext, l: { id: number; mint: string; creator: string }): Promise<Holders | null> {
  const hit = holderCache.get(l.mint);
  if (hit && Date.now() - hit.at < HOLDERS_TTL) return hit.value;
  const fresh = readHolders(ctx, l);
  holderCache.set(l.mint, { at: Date.now(), value: hit ? fresh.then((v) => v ?? hit.value) : fresh });
  if (hit) return hit.value;
  return Promise.race([fresh, new Promise<null>((r) => setTimeout(() => r(null), HOLDERS_WAIT))]);
}

function readHolders(ctx: WebContext, l: { id: number; mint: string; creator: string }): Promise<Holders | null> {
  return (async () => {
    const farms = await ctx.sql`select farm from stake_tiers where launch_id = ${l.id} and farm is not null`;
    const vaults = await Promise.all(farms.map((f: any) => ctx.staking.vaultAuthority(f.farm).catch(() => null)));
    const labels: Record<string, string> = {
      [deriveDbcPoolAuthority().toBase58()]: "Bonding curve",
      [deriveDammV2PoolAuthority().toBase58()]: "Pool",
      [ctx.spillWallet.toBase58()]: "Early exit penalties",
      [l.creator]: "Creator",
    };
    for (const v of vaults) if (v) labels[v] = "Staked";
    const key = process.env.JUPITER_API_KEY;
    const chain = new RpcHolderChain(ctx.conn, key ? "https://api.jup.ag/tokens/v2" : "https://lite-api.jup.ag/tokens/v2", key);
    return holders(chain, l.mint, labels).catch(() => null);
  })();
}

/** Everything the token page refreshes, built from indexed trades plus a cached holder read; shared by every viewer for LIVE_TTL. */
export async function tokenLive(ctx: WebContext, mint: string): Promise<TokenLive | null> {
  const hit = liveCache.get(mint);
  if (hit && Date.now() - hit.at < LIVE_TTL) return hit.value;
  const [l] = await ctx.sql`select id, mint, status, creator from launches where mint = ${mint}`;
  if (!l) return null;
  const value = (async (): Promise<TokenLive> => {
    const id = Number(l.id);
    const m = await market(ctx.sql, id);
    const [curve, trades, act, traders, hs, [pool]] = await Promise.all([
      curveProgress(ctx.sql, id), recentTrades(ctx.sql, id, 25), activity(ctx.sql, id), topTraders(ctx.sql, id, m?.price ?? 0, 10),
      holdersFor(ctx, { id, mint, creator: l.creator }),
      ctx.sql`select status, rent_lamports, basket_value_lamports from stake_pools where launch_id = ${id}`,
    ]);
    return {
      status: l.status, market: m, quoteUsd: m?.priceUsd != null && m.price ? m.priceUsd / m.price : null,
      curve, trades, activity: act, traders, holders: hs, creator: l.creator, staking: stakingOpens(pool), at: Date.now(),
    };
  })();
  liveCache.set(mint, { at: Date.now(), value });
  value.catch(() => liveCache.delete(mint));
  return value;
}
