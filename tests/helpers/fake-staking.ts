import type { StakingAdapter } from "../../src/staking/adapter";
import type { FakeChain } from "./fake-chain";

export class FakeStaking implements StakingAdapter {
  readonly backend = "kamino" as const;
  farms = new Set<string>();
  staked = new Map<string, bigint>();
  available = new Map<string, bigint>();
  slashed = new Map<string, bigint>();
  async vaultAuthority(farm: string) { return `vault-auth-${farm}`; }
  funded: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint }[] = [];
  constructor(private chain: FakeChain) {}
  rewards = new Map<string, string[]>();
  rewardBatches: string[][] = [];
  capabilities() { return { earlyExit: true, tiersOnChain: false, rewardsPerTx: 4 }; }
  async buildCreateFarm() { return this.chain.tx("create_farm"); }
  async buildConfigureFarm(i: { farm: string }) { this.farms.add(i.farm); return this.chain.tx("configure_farm"); }
  async buildAddRewards(farm: string, mints: string[]) {
    this.rewardBatches.push(mints);
    this.rewards.set(farm, [...(this.rewards.get(farm) ?? []), ...mints]);
    return this.chain.tx("add_rewards");
  }
  async farmRewardMints(farm: string) { return this.rewards.get(farm) ?? []; }
  async farmExists(farm: string) { return this.farms.has(farm); }
  async totalStaked(farm: string) { return this.staked.get(farm) ?? 0n; }
  async rewardState(farm: string, mint: string) { return { available: this.available.get(`${farm}:${mint}`) ?? 0n, rpsDecimals: 0, decimals: 6 }; }
  async buildFund(i: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint }) { this.funded.push(i); return this.chain.tx("fund"); }
  async slashedAmount(farm: string) { return this.slashed.get(farm) ?? 0n; }
  async buildCollectPenalty() { return this.chain.tx("collect"); }
  positions = new Map<string, import("../../src/staking/adapter").StakePosition>();
  built: { action: string; owner: string; farm: string; amount?: bigint }[] = [];
  userFarmList: string[] = [];
  async userFarms(_owner: string, farms: string[]) { return this.userFarmList.filter((f) => farms.includes(f)); }
  async position(owner: string, farm: string) { return this.positions.get(`${owner}:${farm}`) ?? null; }
  async buildStakeTx(owner: string, farm: string, _m: string, amount: bigint) { this.built.push({ action: "stake", owner, farm, amount }); return "dHg="; }
  async buildClaimTx(owner: string, farm: string) { this.built.push({ action: "claim", owner, farm }); return "dHg="; }
  async buildExitTx(owner: string, farm: string) { this.built.push({ action: "exit", owner, farm }); return "dHg="; }
  async buildWithdrawTx(owner: string, farm: string) { this.built.push({ action: "withdraw", owner, farm }); return "dHg="; }
}
