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
import { GeckoChart, type ChartSource } from "./chart";

export interface WebContext {
  sql: SQL;
  conn: Connection;
  meteora: MeteoraPort;
  staking: StakingAdapter;
  jupiter: JupiterPort;
  pinata: PinataPort;
  chart: ChartSource;
  trade: TradePort;
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

let ctx: WebContext | null = null;

export const setContextForTests = (c: WebContext | null) => { ctx = c; };

export function getContext(): WebContext {
  if (ctx) return ctx;
  const e = process.env;
  const conn = new Connection(e.RPC_URL!, "confirmed");
  // The web server never signs: these throwaway keypairs only satisfy constructors whose signing paths it never calls.
  const chain = new SolanaChain(conn, Keypair.generate(), Keypair.generate());
  ctx = {
    sql: sharedDb(),
    conn,
    meteora: new MeteoraLive(chain, e.DAMM_V2_MIGRATION_CONFIG!),
    staking: new KaminoBackend(chain, e.RPC_URL!, e.KAMINO_GLOBAL_CONFIG!),
    jupiter: withLocalTokens(new JupiterLive(e.JUPITER_BASE_URL ?? "https://api.jup.ag/swap/v1", chain, fetch, e.JUPITER_API_KEY), e.LOCAL_TOKEN_LIST),
    pinata: e.PINATA_JWT === "stub" ? new DevPinata() : new PinataRest(e.PINATA_JWT!),
    trade: new TradeLive(conn),
    chart: new GeckoChart(e.GECKO_BASE ?? "https://api.geckoterminal.com/api/v2"),
    configKeys: JSON.parse(readFileSync(e.CONFIG_KEYS_PATH ?? "config-keys.json", "utf8")),
    keeperAddress: e.KEEPER_ADDRESS!,
    spillWallet: new PublicKey(e.SPILL_ADDRESS!),
    ourtokenMint: e.OURTOKEN_MINT!,
    adminWallets: new Set((e.ADMIN_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    sessionSecret: new TextEncoder().encode(e.ADMIN_SESSION_SECRET!),
    tokenProgramOf: async (mint) => (await conn.getAccountInfo(new PublicKey(mint)))?.owner.toBase58() ?? "",
  };
  return ctx;
}
