import type { SQL } from "bun";
import type { ChainPort } from "../chain/port";
import type { MeteoraPort } from "../meteora/port";
import type { JupiterPort } from "../jupiter/port";
import type { StakingAdapter } from "../staking/adapter";

export interface KeeperDeps {
  sql: SQL;
  chain: ChainPort;
  meteora: MeteoraPort;
  jupiter: JupiterPort;
  staking: StakingAdapter;
  wallets: { keeper: string; spill: string; treasury: string };
  ourtokenMint: string;
}
