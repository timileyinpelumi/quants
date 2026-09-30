import { Farms, FarmConfigOption, getWithdrawSlashedAmountInstruction } from "@kamino-finance/farms-sdk";
import { createSolanaRpc, createNoopSigner, address, none, type Instruction } from "@solana/kit";
import { Connection, Keypair, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import Decimal from "decimal.js";

const RPC = "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const farms = new Farms(createSolanaRpc(RPC));

const toWeb3 = (ix: Instruction) => new TransactionInstruction({
  programId: new PublicKey(ix.programAddress),
  keys: (ix.accounts ?? []).map((a) => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: a.role === 1 || a.role === 3 })),
  data: Buffer.from(ix.data ?? []),
});
const signer = (kp: Keypair) => createNoopSigner(address(kp.publicKey.toBase58()));
const send = async (label: string, ixs: Instruction[], signers: Keypair[]) => {
  try {
    return await sendAndConfirmTransaction(conn, new Transaction().add(...ixs.map(toWeb3)), signers);
  } catch (e: any) {
    console.log(`FAILED ${label}:`, e.message, e.logs?.slice(-6));
    throw e;
  }
};
const farmState = async (f: ReturnType<typeof address>) => (await farms.getAllFarmStatesByPubkeys([f]))[0]!.farmState;

const admin = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate(), spill = Keypair.generate();
for (const k of [admin, alice, bob, spill]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));

const stakeMint = await createMint(conn, admin, admin.publicKey, null, 6);
const rewardMints = [
  await createMint(conn, admin, admin.publicKey, null, 6),
  await createMint(conn, admin, admin.publicKey, null, 9),
  await createMint(conn, admin, admin.publicKey, null, 6),
];

const globalConfig = Keypair.generate();
await send("createGlobalConfig", await farms.createGlobalConfigIxs(signer(admin), signer(globalConfig)), [admin, globalConfig]);
const gc = address(globalConfig.publicKey.toBase58());
const farm = Keypair.generate();
await send("createFarm", await farms.createFarmIxs(signer(admin), signer(farm), gc, address(stakeMint.toBase58())), [admin, farm]);
const farmAddr = address(farm.publicKey.toBase58());
for (const m of rewardMints) {
  await send("addReward", [await farms.addRewardToFarmIx(signer(admin), gc, farmAddr, address(m.toBase58()), address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))], [admin]);
}
console.log("1. farm with 3 reward mints of decimals 6/9/6 created:", (await farmState(farmAddr)).rewardInfos.filter((r) => r.token.mint !== "11111111111111111111111111111111").length);

const spillAta = await getOrCreateAssociatedTokenAccount(conn, admin, stakeMint, spill.publicKey);
const r0 = address(rewardMints[0]!.toBase58());
const cfg = async (name: string, mode: FarmConfigOption, value: number | bigint | ReturnType<typeof address>) =>
  send(name, [await farms.updateFarmConfigIx(signer(admin), farmAddr, r0, mode, value)], [admin]);
await cfg("LockingMode", FarmConfigOption.LockingMode, 1);
await cfg("LockingDuration", FarmConfigOption.LockingDuration, 60);
await cfg("Penalty", FarmConfigOption.LockingEarlyWithdrawalPenaltyBps, 3000);
await cfg("Cooldown", FarmConfigOption.WithdrawCooldownPeriod, 0);
await cfg("Spill", FarmConfigOption.SlashedAmountSpillAddress, address(spillAta.address.toBase58()));
let st = await farmState(farmAddr);
console.log("2. config:", { lockingMode: st.lockingMode, lockingDuration: st.lockingDuration, penaltyBps: st.lockingEarlyWithdrawalPenaltyBps, cooldown: st.withdrawalCooldownPeriod, spill: st.slashedAmountSpillAddress });

const adminRewardAta = await getOrCreateAssociatedTokenAccount(conn, admin, rewardMints[0]!, admin.publicKey);
await mintTo(conn, admin, rewardMints[0]!, adminRewardAta.address, admin, 10_000_000_000n);
await send("topUp1", [await farms.addRewardAmountToFarmIx(signer(admin), farmAddr, r0, new Decimal(1000))], [admin]);
st = await farmState(farmAddr);
const rpsDec = st.rewardInfos[0]!.rewardsPerSecondDecimals;
console.log("3. rpsDecimals", rpsDec, "rewardsAvailable after 1000 UI top-up", st.rewardInfos[0]!.rewardsAvailable);
const rawRps = (1_000_000_000n * 10n ** BigInt(rpsDec)) / 100n;
await cfg("rps1", FarmConfigOption.UpdateRewardRps, rawRps);
st = await farmState(farmAddr);
console.log("   rps curve after set:", st.rewardInfos[0]!.rewardScheduleCurve.points.slice(0, 2).map((p) => [p.tsStart, p.rewardPerTimeUnit]));

const stakeAmount = 100_000_000n;
for (const [name, u] of [["alice", alice], ["bob", bob]] as const) {
  const ata = await getOrCreateAssociatedTokenAccount(conn, admin, stakeMint, u.publicKey);
  await mintTo(conn, admin, stakeMint, ata.address, admin, stakeAmount);
  await send(`createUser ${name}`, [await farms.createNewUserIx(signer(u), farmAddr)], [u]);
  await send(`stake ${name}`, [await farms.stakeIx(signer(u), farmAddr, new Decimal(stakeAmount.toString()), address(stakeMint.toBase58()), none())], [u]);
  console.log(`4. ${name} stake ata after stake:`, (await getAccount(conn, ata.address)).amount);
}
st = await farmState(farmAddr);
console.log("   totalStakedAmount", st.totalStakedAmount, "(passed Decimal of base units", stakeAmount, "x2)");

await Bun.sleep(20_000);
await send("topUp2", [await farms.addRewardAmountToFarmIx(signer(admin), farmAddr, r0, new Decimal(500))], [admin]);
st = await farmState(farmAddr);
const avail = st.rewardInfos[0]!.rewardsAvailable;
await cfg("rps2", FarmConfigOption.UpdateRewardRps, (avail * 10n ** BigInt(rpsDec)) / 100n);
console.log("5. second top-up + rate change with active stakers OK; rewardsAvailable", avail, "issuedUnclaimed", st.rewardInfos[0]!.rewardsIssuedUnclaimed);

await Bun.sleep(5_000);
const [aliceBefore] = await farms.getUserStatesForUserAndFarm(address(alice.publicKey.toBase58()), farmAddr);
const shares = aliceBefore!.userState.activeStakeScaled;
console.log("   alice activeStakeScaled", shares, "lastStakeTs", aliceBefore!.userState.lastStakeTs);
await send("alice early unstake", [await farms.unstakeIx(signer(alice), farmAddr, new Decimal(shares.toString()), none())], [alice]);
st = await farmState(farmAddr);
console.log("6. slashedAmountCurrent after alice early exit", st.slashedAmountCurrent, "(30% of", stakeAmount, "=", (stakeAmount * 3000n) / 10_000n, "at t=0)");
const pending = await farms.getPendingWithdrawalCooldownStatusForWalletAndFarm(address(alice.publicKey.toBase58()), farmAddr);
console.log("   alice pending withdrawal", pending);
const [aliceUser] = await farms.getUserStatesForUserAndFarm(address(alice.publicKey.toBase58()), farmAddr);
try {
  await send("alice withdraw", [await farms.withdrawUnstakedDepositIx(signer(alice), aliceUser!.key, farmAddr, address(stakeMint.toBase58()))], [alice]);
  const aliceAta = await getOrCreateAssociatedTokenAccount(conn, admin, stakeMint, alice.publicKey);
  console.log("   alice stake ata after withdraw:", (await getAccount(conn, aliceAta.address)).amount);
} catch {
  console.log("   alice withdraw failed (see above)");
}

const claimIxs = await farms.claimForUserForFarmAllRewardsIx(signer(bob), address(bob.publicKey.toBase58()), farmAddr, false);
await send("bob claim", claimIxs, [bob]);
const bobR0 = await getOrCreateAssociatedTokenAccount(conn, admin, rewardMints[0]!, bob.publicKey);
console.log("7. bob reward0 balance after claim", (await getAccount(conn, bobR0.address)).amount);

st = await farmState(farmAddr);
const ix = getWithdrawSlashedAmountInstruction({
  crank: signer(admin), farmState: farmAddr, slashedAmountSpillAddress: address(spillAta.address.toBase58()),
  farmVault: st.farmVault, farmVaultsAuthority: st.farmVaultsAuthority,
});
await send("withdrawSlashed", [ix], [admin]);
console.log("8. spill ATA balance after withdrawSlashedAmount", (await getAccount(conn, spillAta.address)).amount, "slashedAmountCurrent now", (await farmState(farmAddr)).slashedAmountCurrent);
