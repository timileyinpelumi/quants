import { RpcPool, providerOrder } from "@/chain/rpc-pool";
import { withVerifiedCache } from "@/jupiter/verified-cache";
import type { SQL } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { sharedDb } from "@/db/client";
import { SolanaChain } from "@/chain/solana";
import { MeteoraLive, type MeteoraPort } from "@/meteora/port";
import { KaminoBackend } from "@/staking/kamino";
import type { StakingAdapter } from "@/staking/adapter";
import { TradeLive, type TradePort } from "@/meteora/trade";
import type { JupiterPort } from "@/jupiter/port";
import { uploadPrefix, uploadsFrom, type UploadPort } from "./uploads";
import { TokenIcons } from "./icons";
import { JupiterPrices, type PricePort } from "@/indexer/prices";
import { applyClusterDefaults, configKeysPath } from "@/cluster";
import { pricesFor, swapPortFor } from "@/jupiter/select";
import { checkWebEnv } from "@/env";
import { decodeCodeHash } from "@/admin-code";
import { parsePlatformAddresses, type Role } from "@/domain/platform-wallets";
import { StockRegistry } from "@/stocks/registry";
import { rewardMintChecker, type RewardMintCheck } from "@/chain/reward-mint";
import type { StockListing } from "@/stocks/sources";

export interface WebContext {
  sql: SQL;
  conn: Connection;
  meteora: MeteoraPort;
  staking: StakingAdapter;
  jupiter: JupiterPort;
  uploads: UploadPort;
  /** Launch metadata and images must start with this (our upload store), so launches made here only show content uploaded here. */
  uploadPrefix: string | null;
  trade: TradePort;
  icons: TokenIcons;
  prices: PricePort;
  configKeys: Record<string, string>;
  keeperAddress: string;
  spillWallet: PublicKey;
  /** argon2id PHC string of the admin access code. */
  adminCodeHash: string;
  /** Public addresses of the platform HD wallet roles, from PLATFORM_ADDRESSES. Never the seed. */
  platformAddresses: Partial<Record<Role, string>>;
  sessionSecret: Uint8Array;
  tokenProgramOf(mint: string): Promise<string>;
  /** Each mint's token program and why it cannot be a reward token (null when it can), read from chain and remembered. */
  rewardMints: RewardMintCheck;
  stocks: Pick<StockRegistry, "list" | "icons">;
}

// Local development only: a validator's own mints are unknown to Jupiter, so LOCAL_TOKEN_LIST stands in for token search.
function withLocalTokens(j: JupiterPort, list: string | undefined): JupiterPort {
  if (!list) return j;
  const tokens = JSON.parse(list) as Awaited<ReturnType<JupiterPort["searchVerified"]>>;
  return Object.assign(Object.create(j), {
    searchVerified: async (q: string) => tokens.filter((t) => `${t.symbol} ${t.name} ${t.mint}`.toLowerCase().includes(q.toLowerCase())),
    isVerified: async (m: string) => tokens.some((t) => t.mint === m),
    popularVerified: async () => tokens,
  });
}

const g = globalThis as { __quantsCtx?: WebContext | null };

export const setContextForTests = (c: WebContext | null) => { g.__quantsCtx = c; };

export function getContext(): WebContext {
  if (g.__quantsCtx) return g.__quantsCtx;
  const e = applyClusterDefaults(process.env);
  checkWebEnv(e);
  const pool = new RpcPool(providerOrder(e.RPC_URL, e.KEEPER_RPC_URL, e.INDEXER_RPC_URL));
  const conn = new Connection(pool.primary, { commitment: "confirmed", fetch: pool.fetch });
  // The web server never signs: these throwaway keypairs only satisfy constructors whose signing paths it never calls.
  const chain = new SolanaChain(conn, Keypair.generate(), Keypair.generate());
  const sql = sharedDb();
  const meteora = new MeteoraLive(chain, e.DAMM_V2_MIGRATION_CONFIG!);
  // Optional seed: config keys made by scripts/create-configs.ts (stocks need them); crypto pairs get theirs on demand.
  const keysFile = configKeysPath(e);
  const configKeys: Record<string, string> = e.CONFIG_KEYS ? JSON.parse(e.CONFIG_KEYS) : existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, "utf8")) : {};
  const ctx: WebContext = {
    sql,
    conn,
    meteora,
    staking: new KaminoBackend(chain, providerOrder(e.RPC_URL, e.KEEPER_RPC_URL, e.INDEXER_RPC_URL), e.KAMINO_GLOBAL_CONFIG ?? ""),
    jupiter: withVerifiedCache(withLocalTokens(swapPortFor(e, chain), e.LOCAL_TOKEN_LIST), sql),
    uploads: uploadsFrom(e),
    uploadPrefix: uploadPrefix(e),
    trade: new TradeLive(conn),
    prices: pricesFor(e, conn, new JupiterPrices(e.JUPITER_API_KEY ? "https://api.jup.ag/price/v3" : "https://lite-api.jup.ag/price/v3", e.JUPITER_API_KEY)),
    icons: new TokenIcons(e.JUPITER_API_KEY ? "https://api.jup.ag/tokens/v2" : "https://lite-api.jup.ag/tokens/v2", e.JUPITER_API_KEY),
    configKeys,
    keeperAddress: e.KEEPER_ADDRESS!,
    spillWallet: new PublicKey(e.SPILL_ADDRESS!),
    adminCodeHash: decodeCodeHash(e.ADMIN_CODE_HASH),
    platformAddresses: parsePlatformAddresses(e.PLATFORM_ADDRESSES),
    sessionSecret: new TextEncoder().encode(e.ADMIN_SESSION_SECRET!),
    tokenProgramOf: async (mint) => (await conn.getAccountInfo(new PublicKey(mint)))?.owner.toBase58() ?? "",
    rewardMints: rewardMintChecker(conn),
    // LOCAL_STOCKS (local validator only) lists stand-in stock mints in place of the xStocks and Backpack lists.
    stocks: new StockRegistry({
      sql, conn, fetch, configKeys, threshold: (k) => meteora.configThreshold(k),
      local: e.LOCAL_STOCKS ? (JSON.parse(e.LOCAL_STOCKS) as StockListing[]) : undefined,
    }),
  };
  g.__quantsCtx = ctx;
  return ctx;
}
