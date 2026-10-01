import type { SignedTx } from "../chain/port";

export interface StakingAdapter {
  readonly backend: "kamino";
  /** rewardsPerTx is how many reward mints buildAddRewards can register in one transaction. */
  capabilities(): { earlyExit: boolean; tiersOnChain: boolean; rewardsPerTx: number };
  buildCreateFarm(stakeMint: string, farmSecret: Uint8Array): Promise<SignedTx>;
  buildAddRewards(farm: string, rewardMints: string[]): Promise<SignedTx>;
  farmRewardMints(farm: string): Promise<string[]>;
  buildConfigureFarm(i: { farm: string; stakeMint: string; lockSeconds: number; maxPenaltyBps: number; spillAccount: string }): Promise<SignedTx>;
  farmExists(farm: string): Promise<boolean>;
  totalStaked(farm: string): Promise<bigint>;
  /** Owner of the farm's stake vault token account, used to label staked balances among holders. */
  vaultAuthority(farm: string): Promise<string>;
  rewardState(farm: string, rewardMint: string): Promise<{ available: bigint; rpsDecimals: number; decimals: number }>;
  buildFund(i: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint; decimals: number }): Promise<SignedTx>;
  slashedAmount(farm: string): Promise<bigint>;
  buildCollectPenalty(farm: string, spillAccount: string): Promise<SignedTx>;
  position(owner: string, farm: string): Promise<StakePosition | null>;
  userFarms(owner: string): Promise<string[]>;
  buildStakeTx(owner: string, farm: string, stakeMint: string, amount: bigint): Promise<string>;
  buildClaimTx(owner: string, farm: string): Promise<string>;
  buildExitTx(owner: string, farm: string, stakeMint: string): Promise<string>;
  buildWithdrawTx(owner: string, farm: string, stakeMint: string): Promise<string>;
}

export interface StakePosition {
  staked: bigint;
  activeShares: bigint;
  lastStakeTs: number;
  lockSeconds: number;
  pending: { mint: string; amount: bigint }[];
}
