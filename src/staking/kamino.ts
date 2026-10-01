import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Farms, FarmConfigOption, fetchAllMaybeUserState, getUserStatePDA, getWithdrawSlashedAmountInstruction, type UserState } from "@kamino-finance/farms-sdk";
import { address, createNoopSigner, createSolanaRpc, none, type Address } from "@solana/kit";
import Decimal from "decimal.js";
import type { StakePosition, StakingAdapter } from "./adapter";
import { fromKitInstruction, kitSigner, type SolanaChain } from "../chain/solana";
import { REWARDS_PER_TX } from "../domain/launch-cost";

const TOKEN_PROGRAM = address(TOKEN_PROGRAM_ID.toBase58());
const WAD = 10n ** 18n;
const EMPTY_MINT = "11111111111111111111111111111111";
const userSigner = (owner: string) => createNoopSigner(address(owner));

export class KaminoBackend implements StakingAdapter {
  readonly backend = "kamino" as const;
  private farms: Farms;
  private rpc;
  constructor(private chain: SolanaChain, rpcUrl: string, private globalConfig: string) {
    const rpc = createSolanaRpc(rpcUrl);
    this.rpc = rpc;
    this.farms = new Farms(rpc);
  }

  capabilities() { return { earlyExit: true, tiersOnChain: false, rewardsPerTx: REWARDS_PER_TX }; }

  private async state(farm: string) {
    const [f] = await this.farms.getAllFarmStatesByPubkeys([address(farm)]);
    if (!f) throw new Error(`farm ${farm} not found`);
    return f.farmState;
  }

  async buildCreateFarm(stakeMint: string, farmSecret: Uint8Array) {
    const farm = Keypair.fromSecretKey(farmSecret);
    const ixs = await this.farms.createFarmIxs(kitSigner(this.chain.keeper), kitSigner(farm), address(this.globalConfig), address(stakeMint));
    return this.chain.signLegacy(new Transaction().add(...ixs.map(fromKitInstruction)), [farm]);
  }

  async buildAddRewards(farm: string, rewardMints: string[]) {
    const admin = kitSigner(this.chain.keeper);
    const tx = new Transaction();
    for (const m of rewardMints) tx.add(fromKitInstruction(await this.farms.addRewardToFarmIx(admin, address(this.globalConfig), address(farm), address(m), TOKEN_PROGRAM)));
    return this.chain.signLegacy(tx, []);
  }

  async farmRewardMints(farm: string) {
    return (await this.state(farm)).rewardInfos.map((r) => r.token.mint as string).filter((m) => m !== EMPTY_MINT);
  }

  async buildConfigureFarm(i: { farm: string; stakeMint: string; lockSeconds: number; maxPenaltyBps: number; spillAccount: string }) {
    const admin = kitSigner(this.chain.keeper);
    const farm = address(i.farm);
    // Farm-level options ignore the mint; newFarm=true skips the reward index lookup.
    const cfg = async (mode: FarmConfigOption, value: number | bigint | ReturnType<typeof address>) =>
      fromKitInstruction(await this.farms.updateFarmConfigIx(admin, farm, address(EMPTY_MINT), mode, value, -1, undefined, true));
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.chain.keeper.publicKey, new PublicKey(i.spillAccount), this.chain.spill.publicKey, new PublicKey(i.stakeMint)),
      await cfg(FarmConfigOption.LockingMode, 1),
      await cfg(FarmConfigOption.LockingDuration, i.lockSeconds),
      await cfg(FarmConfigOption.LockingEarlyWithdrawalPenaltyBps, i.maxPenaltyBps),
      await cfg(FarmConfigOption.WithdrawCooldownPeriod, 0),
      await cfg(FarmConfigOption.SlashedAmountSpillAddress, address(i.spillAccount)),
    );
    return this.chain.signLegacy(tx, []);
  }

  async farmExists(farm: string) {
    return (await this.chain.conn.getAccountInfo(new PublicKey(farm), "confirmed")) !== null;
  }

  async totalStaked(farm: string) { return (await this.state(farm)).totalStakedAmount; }

  async vaultAuthority(farm: string) { return String((await this.state(farm)).farmVaultsAuthority); }

  async rewardState(farm: string, rewardMint: string) {
    const r = (await this.state(farm)).rewardInfos.find((x) => x.token.mint === rewardMint);
    if (!r) throw new Error(`reward ${rewardMint} not on farm ${farm}`);
    return { available: r.rewardsAvailable, rpsDecimals: r.rewardsPerSecondDecimals, decimals: Number(r.token.decimals) };
  }

  async buildFund(i: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint; decimals: number }) {
    const admin = kitSigner(this.chain.keeper);
    const ui = new Decimal(i.amount.toString()).div(new Decimal(10).pow(i.decimals));
    const topUp = await this.farms.addRewardAmountToFarmIx(admin, address(i.farm), address(i.rewardMint), ui);
    const rate = await this.farms.updateFarmConfigIx(admin, address(i.farm), address(i.rewardMint), FarmConfigOption.UpdateRewardRps, i.rawRps);
    const tx = new Transaction();
    // The keeper holds SOL rewards as native lamports; Kamino pulls from the wSOL account.
    if (i.rewardMint === NATIVE_MINT.toBase58()) {
      const keeper = this.chain.keeper.publicKey;
      const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, keeper);
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(keeper, wsol, keeper, NATIVE_MINT),
        SystemProgram.transfer({ fromPubkey: keeper, toPubkey: wsol, lamports: i.amount }),
        createSyncNativeInstruction(wsol),
      );
    }
    tx.add(fromKitInstruction(topUp), fromKitInstruction(rate));
    return this.chain.signLegacy(tx, []);
  }

  async slashedAmount(farm: string) { return (await this.state(farm)).slashedAmountCurrent; }

  async buildCollectPenalty(farm: string, spillAccount: string) {
    const s = await this.state(farm);
    const ix = getWithdrawSlashedAmountInstruction({
      crank: kitSigner(this.chain.keeper), farmState: address(farm), slashedAmountSpillAddress: address(spillAccount),
      farmVault: s.farmVault, farmVaultsAuthority: s.farmVaultsAuthority, tokenProgram: TOKEN_PROGRAM,
    });
    return this.chain.signLegacy(new Transaction().add(fromKitInstruction(ix)), []);
  }

  private async unsigned(ixs: TransactionInstruction[], owner: string): Promise<string> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = new PublicKey(owner);
    tx.recentBlockhash = (await this.chain.conn.getLatestBlockhash("confirmed")).blockhash;
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  }

  // User states live at a PDA of (farm, owner), so they are read directly instead of scanning the farms program.
  private async userStates(owner: string, farms: string[]) {
    const keys = await Promise.all(farms.map((f) => getUserStatePDA(this.farms.getProgramID(), address(f), address(owner))));
    const out: ({ key: Address; userState: UserState } | null)[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      const accts = await fetchAllMaybeUserState(this.rpc, keys.slice(i, i + 100), { commitment: "confirmed" });
      for (const a of accts) out.push(a.exists ? { key: a.address, userState: a.data } : null);
    }
    return out;
  }

  private async userState(owner: string, farm: string) {
    const [u] = await this.userStates(owner, [farm]);
    return u ?? null;
  }

  async userFarms(owner: string, farms: string[]): Promise<string[]> {
    const states = await this.userStates(owner, farms);
    return farms.filter((_f, i) => states[i] != null);
  }

  async position(owner: string, farm: string): Promise<StakePosition | null> {
    const u = await this.userState(owner, farm);
    if (!u) return null;
    const fs = await this.state(farm);
    const now = new Decimal(Math.floor(Date.now() / 1000));
    const { userPendingRewardAmounts } = this.farms.getUserPendingRewards(u.userState, fs, now, null);
    const pending = fs.rewardInfos
      .map((r, i) => {
        const d = userPendingRewardAmounts[i]!;
        // The SDK's estimate is NaN when the farm has no stake left; the stored unclaimed amount is then exact.
        const amount = d.isFinite() ? (d.gt(0) ? BigInt(d.floor().toFixed(0)) : 0n) : u.userState.rewardsIssuedUnclaimed[i]!;
        return { mint: r.token.mint as string, amount };
      })
      .filter((r) => r.mint !== EMPTY_MINT);
    return {
      staked: u.userState.activeStakeScaled / WAD,
      activeShares: u.userState.activeStakeScaled,
      lastStakeTs: Number(u.userState.lastStakeTs),
      lockSeconds: Number(fs.lockingDuration),
      pending,
    };
  }

  async buildStakeTx(owner: string, farm: string, stakeMint: string, amount: bigint): Promise<string> {
    const ixs: TransactionInstruction[] = [];
    if (!(await this.userState(owner, farm))) ixs.push(fromKitInstruction(await this.farms.createNewUserIx(userSigner(owner), address(farm))));
    ixs.push(fromKitInstruction(await this.farms.stakeIx(userSigner(owner), address(farm), new Decimal(amount.toString()), address(stakeMint), none())));
    return this.unsigned(ixs, owner);
  }

  async buildClaimTx(owner: string, farm: string): Promise<string> {
    const ixs = await this.farms.claimForUserForFarmAllRewardsIx(userSigner(owner), address(owner), address(farm), false);
    return this.unsigned(ixs.map(fromKitInstruction), owner);
  }

  // Unstake takes stake shares scaled by 1e18, not token amounts (see docs/spikes/kamino.md).
  async buildExitTx(owner: string, farm: string, stakeMint: string): Promise<string> {
    const u = await this.userState(owner, farm);
    if (!u || u.userState.activeStakeScaled === 0n) throw new Error("nothing staked");
    return this.unsigned([
      fromKitInstruction(await this.farms.unstakeIx(userSigner(owner), address(farm), new Decimal(u.userState.activeStakeScaled.toString()), none())),
      fromKitInstruction(await this.farms.withdrawUnstakedDepositIx(userSigner(owner), u.key, address(farm), address(stakeMint))),
    ], owner);
  }

  buildWithdrawTx(owner: string, farm: string, stakeMint: string): Promise<string> {
    return this.buildExitTx(owner, farm, stakeMint);
  }
}
