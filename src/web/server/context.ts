import type { SQL } from "bun";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { sharedDb } from "@/db/client";
import { SolanaChain } from "@/chain/solana";
import { MeteoraLive, type MeteoraPort } from "@/meteora/port";
import { KaminoBackend } from "@/staking/kamino";
import type { StakingAdapter } from "@/staking/adapter";
import { TradeLive, type TradePort } from "@/meteora/trade";
import { JupiterLive, type JupiterPort } from "@/jupiter/port";
import { DevPinata, PinataRest, type PinataPort } from "./pinata";
import { TokenIcons } from "./icons";
import { JupiterPrices } from "@/indexer/prices";

export interface WebContext {
  sql: SQL;
  conn: Connection;
  meteora: MeteoraPort;
  staking: StakingAdapter;
  jupiter: JupiterPort;
  pinata: PinataPort;
  trade: TradePort;
  icons: TokenIcons;
  prices: JupiterPrices;
  configKeys: Record<string, string>;
  keeperAddress: string;
  spillWallet: PublicKey;
  ourtokenMint: string;
  adminWallets: Set<string>;
  sessionSecret: Uint8Array;
  tokenProgramOf(mint: string): Promise<string>;
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
  const e = process.env;
  const conn = new Connection(e.RPC_URL!, "confirmed");
  // The web server never signs: these throwaway keypairs only satisfy constructors whose signing paths it never calls.
  const chain = new SolanaChain(conn, Keypair.generate(), Keypair.generate());
  const ctx: WebContext = {
    sql: sharedDb(),
    conn,
    meteora: new MeteoraLive(chain, e.DAMM_V2_MIGRATION_CONFIG!),
    staking: new KaminoBackend(chain, e.RPC_URL!, e.KAMINO_GLOBAL_CONFIG!),
    jupiter: withLocalTokens(new JupiterLive(e.JUPITER_BASE_URL ?? "https://api.jup.ag/swap/v1", chain, fetch, e.JUPITER_API_KEY), e.LOCAL_TOKEN_LIST),
    pinata: e.PINATA_JWT === "stub" ? new DevPinata() : new PinataRest(e.PINATA_JWT!),
    trade: new TradeLive(conn),
    prices: new JupiterPrices(e.JUPITER_API_KEY ? "https://api.jup.ag/price/v3" : "https://lite-api.jup.ag/price/v3", e.JUPITER_API_KEY),
    icons: new TokenIcons(e.JUPITER_API_KEY ? "https://api.jup.ag/tokens/v2" : "https://lite-api.jup.ag/tokens/v2", e.JUPITER_API_KEY),
    configKeys: JSON.parse(readFileSync(e.CONFIG_KEYS_PATH ?? "config-keys.json", "utf8")),
    keeperAddress: e.KEEPER_ADDRESS!,
    spillWallet: new PublicKey(e.SPILL_ADDRESS!),
    ourtokenMint: e.OURTOKEN_MINT!,
    adminWallets: new Set((e.ADMIN_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    sessionSecret: new TextEncoder().encode(e.ADMIN_SESSION_SECRET!),
    tokenProgramOf: async (mint) => (await conn.getAccountInfo(new PublicKey(mint)))?.owner.toBase58() ?? "",
  };
  g.__quantsCtx = ctx;
  return ctx;
}
