import type { SQL } from "bun";
import type { ChainPort } from "../chain/port";
import type { MeteoraPort } from "../meteora/port";

export interface KeeperDeps {
  sql: SQL;
  chain: ChainPort;
  meteora: MeteoraPort;
  wallets: { keeper: string; spill: string; treasury: string };
  ourtokenMint: string;
}
