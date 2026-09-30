import type { SignedTx } from "../chain/port";

export interface StakingAdapter {
  readonly backend: "kamino";
  capabilities(): { earlyExit: boolean; tiersOnChain: boolean };
  buildCreateFarm(stakeMint: string, farmSecret: Uint8Array): Promise<SignedTx>;
  buildConfigureFarm(i: { farm: string; stakeMint: string; lockSeconds: number; maxPenaltyBps: number; spillAccount: string; rewardMints: string[] }): Promise<SignedTx>;
  farmExists(farm: string): Promise<boolean>;
  totalStaked(farm: string): Promise<bigint>;
  rewardState(farm: string, rewardMint: string): Promise<{ available: bigint; rpsDecimals: number; decimals: number }>;
  buildFund(i: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint; decimals: number }): Promise<SignedTx>;
  slashedAmount(farm: string): Promise<bigint>;
  buildCollectPenalty(farm: string, spillAccount: string): Promise<SignedTx>;
}
