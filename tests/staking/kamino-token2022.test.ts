import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createInitializeMetadataPointerInstruction, createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction, createMint, getAccount, getAssociatedTokenAddressSync, getMintLen, getOrCreateAssociatedTokenAccount,
  mintTo, tokenMetadataInitializeWithRentTransfer,
} from "@solana/spl-token";
import { Farms } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import { SolanaChain, fromKitInstruction, kitSigner } from "../../src/chain/solana";
import { KaminoBackend } from "../../src/staking/kamino";
import { kaminoRawRps } from "../../src/domain/rate";
import { rewardMintChecker } from "../../src/chain/reward-mint";
import { TOKEN_ACCOUNT_RENT as REWARD_VAULT_RENT } from "../../src/domain/launch-cost";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const up = await conn.getAccountInfo(new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr")).then((a) => a !== null, () => false);
const T22 = TOKEN_2022_PROGRAM_ID;

async function signSend(base64: string, signer: Keypair) {
  const tx = Transaction.from(Buffer.from(base64, "base64"));
  tx.partialSign(signer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const res = await conn.confirmTransaction(sig, "confirmed");
  expect(res.value.err).toBeNull();
}

/** A Token-2022 mint shaped like most new Token-2022 launches: a metadata pointer to itself and the metadata on the mint. */
async function metadataMint(payer: Keypair, decimals: number) {
  const m = Keypair.generate();
  const len = getMintLen([ExtensionType.MetadataPointer]);
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: m.publicKey, lamports: await conn.getMinimumBalanceForRentExemption(len), space: len, programId: T22 }),
    createInitializeMetadataPointerInstruction(m.publicKey, payer.publicKey, m.publicKey, T22),
    createInitializeMintInstruction(m.publicKey, decimals, payer.publicKey, null, T22),
  ), [payer, m]);
  await tokenMetadataInitializeWithRentTransfer(conn, payer, m.publicKey, payer.publicKey, payer, "Meta Reward", "META", "https://example.com/meta.json", [], { commitment: "confirmed" }, T22);
  return m.publicKey;
}

async function transferFeeMint(payer: Keypair) {
  const m = Keypair.generate();
  const len = getMintLen([ExtensionType.TransferFeeConfig]);
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: m.publicKey, lamports: await conn.getMinimumBalanceForRentExemption(len), space: len, programId: T22 }),
    createInitializeTransferFeeConfigInstruction(m.publicKey, payer.publicKey, payer.publicKey, 100, 1_000_000n, T22),
    createInitializeMintInstruction(m.publicKey, 6, payer.publicKey, null, T22),
  ), [payer, m]);
  return m.publicKey;
}

test.skipIf(!up)("a farm pays one classic and one Token-2022 metadata reward: add, fund, stake, harvest both", async () => {
  const keeper = Keypair.generate(), spill = Keypair.generate(), user = Keypair.generate();
  for (const k of [keeper, spill, user]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, spill);
  const farms = new Farms(createSolanaRpc(RPC));
  const gc = Keypair.generate();
  await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
  const kamino = new KaminoBackend(chain, RPC, gc.publicKey.toBase58());

  const stakeMint = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const classic = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const meta = await metadataMint(keeper, 9);
  const fee = await transferFeeMint(keeper);

  const check = await rewardMintChecker(conn)([classic.toBase58(), meta.toBase58(), fee.toBase58()]);
  expect(check.get(classic.toBase58())).toEqual({ program: TOKEN_PROGRAM_ID.toBase58(), problem: null });
  expect(check.get(meta.toBase58())).toEqual({ program: T22.toBase58(), problem: null });
  expect(check.get(fee.toBase58())!.problem).toBe("has the transfer fee config extension");

  const farm = Keypair.generate();
  const f = farm.publicKey.toBase58();
  const run = async (t: Promise<{ send(): Promise<void>; signature: string; lastValidBlockHeight: bigint }>) => {
    const tx = await t; await tx.send();
    expect(await chain.waitForConfirmation(tx.signature, tx.lastValidBlockHeight)).toBe("confirmed");
  };
  await run(kamino.buildCreateFarm(stakeMint.toBase58(), farm.secretKey));
  await run(kamino.buildConfigureFarm({
    farm: f, stakeMint: stakeMint.toBase58(), lockSeconds: 120, maxPenaltyBps: 3000,
    spillAccount: getAssociatedTokenAddressSync(stakeMint, spill.publicKey).toBase58(),
  }));
  await run(kamino.buildAddRewards(f, [classic.toBase58(), meta.toBase58()]));
  expect((await kamino.farmRewardMints(f)).sort()).toEqual([classic.toBase58(), meta.toBase58()].sort());
  const [fs] = await farms.getAllFarmStatesByPubkeys([address(f)]);
  const programOf = (m: PublicKey) => fs!.farmState.rewardInfos.find((r) => r.token.mint === m.toBase58())!.token.tokenProgram;
  expect(programOf(classic)).toBe(address(TOKEN_PROGRAM_ID.toBase58()));
  expect(programOf(meta)).toBe(address(T22.toBase58()));
  // The launch cost estimate prices every reward vault as a token account of REWARD_VAULT_RENT.
  for (const m of [classic, meta]) {
    const vault = await conn.getAccountInfo(new PublicKey(fs!.farmState.rewardInfos.find((r) => r.token.mint === m.toBase58())!.rewardsVault));
    console.log(`${m.equals(meta) ? "Token-2022" : "classic"} reward vault: ${vault!.data.length} bytes, ${vault!.lamports} lamports`);
    expect(BigInt(vault!.lamports)).toBeLessThanOrEqual(REWARD_VAULT_RENT);
  }

  // The keeper holds each reward in its own program's associated account, as a Jupiter swap leaves it.
  const kc = await getOrCreateAssociatedTokenAccount(conn, keeper, classic, keeper.publicKey);
  await mintTo(conn, keeper, classic, kc.address, keeper, 10_000_000n);
  const km = await getOrCreateAssociatedTokenAccount(conn, keeper, meta, keeper.publicKey, false, "confirmed", undefined, T22);
  await mintTo(conn, keeper, meta, km.address, keeper, 10_000_000_000n, [], undefined, T22);
  expect(await chain.balance(keeper.publicKey.toBase58(), meta.toBase58())).toBe(10_000_000_000n);
  for (const [mint, amount] of [[classic, 10_000_000n], [meta, 10_000_000_000n]] as const) {
    const rs = await kamino.rewardState(f, mint.toBase58());
    await run(kamino.buildFund({ farm: f, rewardMint: mint.toBase58(), amount, rawRps: kaminoRawRps(amount, 100, rs.rpsDecimals), decimals: rs.decimals }));
    expect((await kamino.rewardState(f, mint.toBase58())).available).toBe(amount);
  }
  expect(await chain.balance(keeper.publicKey.toBase58(), meta.toBase58())).toBe(0n);

  const userStake = await getOrCreateAssociatedTokenAccount(conn, keeper, stakeMint, user.publicKey);
  await mintTo(conn, keeper, stakeMint, userStake.address, keeper, 1_000_000n);
  const owner = user.publicKey.toBase58();
  await signSend(await kamino.buildStakeTx(owner, f, stakeMint.toBase58(), 1_000_000n), user);
  await Bun.sleep(4_000);
  const pending = (await kamino.position(owner, f))!.pending;
  for (const m of [classic, meta]) expect(pending.find((r) => r.mint === m.toBase58())!.amount).toBeGreaterThan(0n);

  // One claim creates the user's account for each reward under its own program and harvests both.
  await signSend(await kamino.buildClaimTx(owner, f), user);
  const gotClassic = (await getAccount(conn, getAssociatedTokenAddressSync(classic, user.publicKey))).amount;
  const gotMeta = (await getAccount(conn, getAssociatedTokenAddressSync(meta, user.publicKey, false, T22), "confirmed", T22)).amount;
  console.log(`harvested classic ${gotClassic}, Token-2022 ${gotMeta}`);
  expect(gotClassic).toBeGreaterThan(0n);
  expect(gotMeta).toBeGreaterThan(0n);

  await Bun.sleep(2_000);
  await signSend(await kamino.buildClaimTx(owner, f), user);
  expect((await getAccount(conn, getAssociatedTokenAddressSync(meta, user.publicKey, false, T22), "confirmed", T22)).amount).toBeGreaterThan(gotMeta);
});
