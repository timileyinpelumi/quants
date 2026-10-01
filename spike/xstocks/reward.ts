import { Farms, FarmConfigOption } from "@kamino-finance/farms-sdk";
import { createSolanaRpc, createNoopSigner, address, none, type Instruction } from "@solana/kit";
import { Connection, Keypair, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, getMint,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID, getExtensionTypes,
} from "@solana/spl-token";
import Decimal from "decimal.js";

const RPC = process.env.RPC ?? "http://127.0.0.1:8999";
const SP = "/tmp/claude-1000/-home-timileyin-dev-personal/1566bdc7-c9a1-4273-9e5e-f550946fa998/scratchpad/xstock-spike";
const XMINT = new PublicKey(process.env.XMINT ?? "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
const HOLDER = new PublicKey(process.env.HOLDER ?? "7zYyxcgzL6RRxscj1yvbyrz4arSZ3KAQ61LRBKS2dgKz");
const T22 = address(TOKEN_2022_PROGRAM_ID.toBase58());

const conn = new Connection(RPC, "confirmed");
const farms = new Farms(createSolanaRpc(RPC));
const toWeb3 = (ix: Instruction) => new TransactionInstruction({
  programId: new PublicKey(ix.programAddress),
  keys: (ix.accounts ?? []).map((a) => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: a.role === 1 || a.role === 3 })),
  data: Buffer.from(ix.data ?? []),
});
const signer = (kp: Keypair) => createNoopSigner(address(kp.publicKey.toBase58()));
const send = async (label: string, ixs: (Instruction | TransactionInstruction)[], signers: Keypair[]) => {
  try {
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs.map((i) => ("programAddress" in i ? toWeb3(i) : i))), signers);
    console.log(`ok   ${label}`);
    return sig;
  } catch (e: any) {
    console.log(`FAIL ${label}:`, e.message, "\n  ", (e.logs ?? (await e.getLogs?.(conn).catch(() => null)) ?? []).slice(-8).join("\n   "));
    throw e;
  }
};
const farmState = async (f: ReturnType<typeof address>) => (await farms.getAllFarmStatesByPubkeys([f]))[0]!.farmState;
const bal = async (a: PublicKey) => (await getAccount(conn, a, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;

const admin = Keypair.fromSecretKey(Uint8Array.from(await Bun.file(`${SP}/admin.json`).json()));
const alice = Keypair.generate();
for (const k of [admin, alice]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));

const mintInfo = await getMint(conn, XMINT, "confirmed", TOKEN_2022_PROGRAM_ID);
console.log("reward mint", XMINT.toBase58(), "decimals", mintInfo.decimals, "extensions", getExtensionTypes(mintInfo.tlvData));

// Move NVDAx from the cloned holder account into the admin's Token-2022 ATA (the SDK funds from the payer ATA).
const adminAta = getAssociatedTokenAddressSync(XMINT, admin.publicKey, false, TOKEN_2022_PROGRAM_ID);
const holderBal = await bal(HOLDER);
await send("admin ATA + transferChecked from holder", [
  createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminAta, admin.publicKey, XMINT, TOKEN_2022_PROGRAM_ID),
  createTransferCheckedInstruction(HOLDER, XMINT, adminAta, admin.publicKey, holderBal, mintInfo.decimals, [], TOKEN_2022_PROGRAM_ID),
], [admin]);
console.log("   admin ATA balance", await bal(adminAta));

const stakeMint = await createMint(conn, admin, admin.publicKey, null, 6);
const globalConfig = Keypair.generate();
await send("createGlobalConfig", await farms.createGlobalConfigIxs(signer(admin), signer(globalConfig)), [admin, globalConfig]);
const gc = address(globalConfig.publicKey.toBase58());
const farm = Keypair.generate();
await send("createFarm", await farms.createFarmIxs(signer(admin), signer(farm), gc, address(stakeMint.toBase58())), [admin, farm]);
const farmAddr = address(farm.publicKey.toBase58());
const xm = address(XMINT.toBase58());

// (1) add Token-2022 reward mint
await send("addRewardToFarm (Token-2022)", [await farms.addRewardToFarmIx(signer(admin), gc, farmAddr, xm, T22)], [admin]);
let st = await farmState(farmAddr);
const ri = st.rewardInfos.find((r) => r.token.mint === xm)!;
console.log("   rewardInfo.token", ri.token, "rewardsVault", ri.rewardsVault);
const vault = new PublicKey(ri.rewardsVault);
const vaultAcct = await getAccount(conn, vault, "confirmed", TOKEN_2022_PROGRAM_ID);
console.log("   rewards vault owner program", (await conn.getAccountInfo(vault))!.owner.toBase58(), "frozen", vaultAcct.isFrozen, "account extensions", getExtensionTypes(vaultAcct.tlvData));

// (2) fund
await send("addRewardAmountToFarm 10 NVDAx", [await farms.addRewardAmountToFarmIx(signer(admin), farmAddr, xm, new Decimal(10))], [admin]);
st = await farmState(farmAddr);
const r = st.rewardInfos.find((x) => x.token.mint === xm)!;
console.log("   rewardsAvailable", r.rewardsAvailable, "vault balance", await bal(vault));
const rawRps = (r.rewardsAvailable * 10n ** BigInt(r.rewardsPerSecondDecimals)) / 60n;
await send("UpdateRewardRps", [await farms.updateFarmConfigIx(signer(admin), farmAddr, xm, FarmConfigOption.UpdateRewardRps, rawRps)], [admin]);

// (3) stake + harvest
const aliceStake = await getOrCreateAssociatedTokenAccount(conn, admin, stakeMint, alice.publicKey);
await mintTo(conn, admin, stakeMint, aliceStake.address, admin, 100_000_000n);
await send("alice createUser", [await farms.createNewUserIx(signer(alice), farmAddr)], [alice]);
await send("alice stake", [await farms.stakeIx(signer(alice), farmAddr, new Decimal(100_000_000), address(stakeMint.toBase58()), none())], [alice]);
await Bun.sleep(15_000);
await send("alice harvest", await farms.claimForUserForFarmAllRewardsIx(signer(alice), address(alice.publicKey.toBase58()), farmAddr, false), [alice]);
const aliceX = getAssociatedTokenAddressSync(XMINT, alice.publicKey, false, TOKEN_2022_PROGRAM_ID);
console.log("   alice NVDAx ATA balance (raw)", await bal(aliceX), "vault after", await bal(vault));

// Optional: pause the mint (only works when the spike's mint lets admin be the pause authority).
if (process.env.TRY_PAUSE) {
  const { createPauseInstruction, createResumeInstruction } = await import("@solana/spl-token");
  await send("pause mint", [createPauseInstruction(XMINT, admin.publicKey, [], TOKEN_2022_PROGRAM_ID)], [admin]);
  await Bun.sleep(3_000);
  await send("addRewardAmountToFarm while paused", [await farms.addRewardAmountToFarmIx(signer(admin), farmAddr, xm, new Decimal(1))], [admin]).catch(() => {});
  await send("alice harvest while paused", await farms.claimForUserForFarmAllRewardsIx(signer(alice), address(alice.publicKey.toBase58()), farmAddr, false), [alice]).catch(() => {});
  await send("resume mint", [createResumeInstruction(XMINT, admin.publicKey, [], TOKEN_2022_PROGRAM_ID)], [admin]);
  await send("alice harvest after resume", await farms.claimForUserForFarmAllRewardsIx(signer(alice), address(alice.publicKey.toBase58()), farmAddr, false), [alice]).catch(() => {});
  console.log("   alice NVDAx after resume", await bal(aliceX));
}
