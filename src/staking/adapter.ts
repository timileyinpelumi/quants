import type { SignedTx } from "../chain/port";

export interface StakingAdapter {
  readonly backend: "kamino";
  /** rewardsPerTx is how many reward mints buildAddRewards can register in one transaction. */
  capabilities(): { earlyExit: boolean; tiersOnChain: boolean; rewardsPerTx: number };
  /** The global config new farms are created under, or "" until one exists. */
  globalConfig(): string;
  setGlobalConfig(address: string): void;
  /** Creates a global config at the keypair's address with the keeper as admin and no treasury fee. */
  buildCreateGlobalConfig(secret: Uint8Array): Promise<SignedTx>;
  buildCreateFarm(stakeMint: string, farmSecret: Uint8Array): Promise<SignedTx>;
  buildAddRewards(farm: string, rewardMints: string[]): Promise<SignedTx>;
  farmRewardMints(farm: string): Promise<string[]>;
  buildConfigureFarm(i: { farm: string; stakeMint: string; lockSeconds: number; maxPenaltyBps: number; spillAccount: string }): Promise<SignedTx>;
  farmExists(farm: string): Promise<boolean>;
  totalStaked(farm: string): Promise<bigint>;
  /** User accounts opened across these farms, read in batches. */
  farmUsers(farms: string[]): Promise<number>;
  /** Owner of the farm's stake vault token account, used to label staked balances among holders. */
  vaultAuthority(farm: string): Promise<string>;
  rewardState(farm: string, rewardMint: string): Promise<{ available: bigint; rpsDecimals: number; decimals: number }>;
  buildFund(i: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint; decimals: number }): Promise<SignedTx>;
  slashedAmount(farm: string): Promise<bigint>;
  buildCollectPenalty(farm: string, spillAccount: string): Promise<SignedTx>;
  /** Every user of the farm with their active stake. */
  farmStakers(farm: string): Promise<{ owner: string; staked: bigint; lastStakeTs: number }[]>;
  position(owner: string, farm: string): Promise<StakePosition | null>;
  /** The subset of `farms` the owner has a user state in. */
  userFarms(owner: string, farms: string[]): Promise<string[]>;
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
