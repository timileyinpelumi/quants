import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Farms, FarmConfigOption, getWithdrawSlashedAmountInstruction } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import Decimal from "decimal.js";
import type { StakingAdapter } from "./adapter";
import { fromKitInstruction, kitSigner, type SolanaChain } from "../chain/solana";

const TOKEN_PROGRAM = address(TOKEN_PROGRAM_ID.toBase58());

export class KaminoBackend implements StakingAdapter {
  readonly backend = "kamino" as const;
  private farms: Farms;
  constructor(private chain: SolanaChain, rpcUrl: string, private globalConfig: string) {
    this.farms = new Farms(createSolanaRpc(rpcUrl));
  }

  capabilities() { return { earlyExit: true, tiersOnChain: false }; }

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

  async buildConfigureFarm(i: { farm: string; stakeMint: string; lockSeconds: number; maxPenaltyBps: number; spillAccount: string; rewardMints: string[] }) {
    const admin = kitSigner(this.chain.keeper);
    const farm = address(i.farm);
    const first = address(i.rewardMints[0]!);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.chain.keeper.publicKey, new PublicKey(i.spillAccount), this.chain.spill.publicKey, new PublicKey(i.stakeMint)),
    );
    for (const m of i.rewardMints) tx.add(fromKitInstruction(await this.farms.addRewardToFarmIx(admin, address(this.globalConfig), farm, address(m), TOKEN_PROGRAM)));
    const cfg = async (mode: FarmConfigOption, value: number | bigint | ReturnType<typeof address>) =>
      fromKitInstruction(await this.farms.updateFarmConfigIx(admin, farm, first, mode, value, -1, undefined, true));
    tx.add(
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
}
