import type { Connection } from "@solana/web3.js";
import type { SolanaChain } from "../chain/solana";
import { clusterOf } from "../cluster";
import { quoteCoins } from "../domain/quotes";
import { PoolPrices, type JupiterPrices, type PricePort } from "../indexer/prices";
import { JupiterLive, type JupiterPort } from "./port";
import { DammLive, DammSwap, dammDecimals, poolTokens } from "./damm";

type Env = Record<string, string | undefined>;

/** Jupiter everywhere it exists; on devnet, swaps through the DAMM v2 pools from scripts/devnet-bootstrap.ts. */
export function swapPortFor(env: Env, chain: SolanaChain): JupiterPort {
  if (clusterOf(env) !== "devnet") return new JupiterLive(env.JUPITER_BASE_URL || "https://api.jup.ag/swap/v1", chain, fetch, env.JUPITER_API_KEY);
  const tokens = poolTokens(env);
  return new DammSwap(chain, new DammLive(chain.conn, dammDecimals(tokens)), tokens, () => chain.conn.getLatestBlockhash("confirmed"));
}

/** Jupiter prices as given, except on devnet: stand-in quote mints priced as their mainnet mint, pool tokens from their pool. */
export function pricesFor(env: Env, conn: Connection, jupiter: JupiterPrices): PricePort {
  if (clusterOf(env) !== "devnet") return jupiter;
  const tokens = poolTokens(env);
  const live = new DammLive(conn, dammDecimals(tokens));
  const pools = new Map(tokens.map((t) => [t.mint, t.pool]));
  const mainnetOf = Object.fromEntries(quoteCoins(env).filter((c) => c.iconMint && c.iconMint !== c.mint).map((c) => [c.mint, c.iconMint!]));
  return new PoolPrices(jupiter, mainnetOf, new Set(pools.keys()), (m) => live.priceInSol(pools.get(m)!, m));
}
