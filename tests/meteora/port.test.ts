import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DynamicBondingCurveClient, SwapMode, deriveDbcPoolAuthority, deriveDammV2PoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { SolanaChain } from "../../src/chain/solana";
import { MeteoraLive } from "../../src/meteora/port";
import { buildQuantsConfig } from "../../src/meteora/config";
import { NATIVE_MINT } from "../../src/domain/types";

const DAMM_CUSTOM = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";
const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const up = await conn.getAccountInfo(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN")).then((a) => a !== null, () => false);

test.skipIf(!up)("launch, claim partner fee, graduate, find position, claim position fee", async () => {
  const keeper = Keypair.generate(), creator = Keypair.generate(), buyer = Keypair.generate();
  for (const k of [keeper.publicKey, creator.publicKey, buyer.publicKey, deriveDbcPoolAuthority(), deriveDammV2PoolAuthority()]) {
    await conn.confirmTransaction(await conn.requestAirdrop(k, 50 * LAMPORTS_PER_SOL));
  }
  const chain = new SolanaChain(conn, keeper, Keypair.generate());
  const m = new MeteoraLive(chain, DAMM_CUSTOM);
  const run = async (t: { send(): Promise<void>; signature: string; lastValidBlockHeight: bigint }) => {
    await t.send();
    expect(await chain.waitForConfirmation(t.signature, t.lastValidBlockHeight)).toBe("confirmed");
  };

  const config = Keypair.generate();
  const client = DynamicBondingCurveClient.create(conn);
  const ctx = await client.partner.createConfig({
    config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey,
    quoteMint: new PublicKey(NATIVE_MINT), payer: keeper.publicKey,
    ...buildQuantsConfig(200, { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 10 }),
  });
  await sendAndConfirmTransaction(conn, ctx, [keeper, config]);

  const keeperBefore = await conn.getBalance(keeper.publicKey);
  const { tx, baseMint, pool } = await m.buildLaunchTx({
    name: "Cat", symbol: "CAT", uri: "https://example.com/cat.json", creator: creator.publicKey.toBase58(),
    configKey: config.publicKey.toBase58(), quoteMint: NATIVE_MINT, devBuyQuoteAmount: 1_000_000_000n, devBuyMinOut: 0n,
  });
  expect(tx.instructions.some((ix) => ix.programId.equals(SystemProgram.programId) && ix.keys.some((k) => k.pubkey.equals(keeper.publicKey)))).toBe(false);
  tx.partialSign(creator);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()));
  expect(await conn.getBalance(keeper.publicKey)).toBe(keeperBefore);
  const bought = BigInt((await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(baseMint.publicKey, creator.publicKey))).value.amount);
  const maxOut = await m.firstBuyMaxOut(config.publicKey.toBase58(), 1_000_000_000n);
  expect(bought).toBeGreaterThan(0n);
  expect(maxOut).toBeGreaterThanOrEqual(bought);
  expect(maxOut * 9n).toBeLessThan(bought * 10n);
  expect(await m.curveState(pool)).toEqual({ migrated: false, complete: false });
  expect(await m.poolInfo(pool)).toEqual({ baseMint: baseMint.publicKey.toBase58(), config: config.publicKey.toBase58(), creator: creator.publicKey.toBase58() });

  const fee = await m.pendingPartnerQuoteFee(pool);
  expect(fee).toBeGreaterThan(0n);
  await run(await m.buildClaimPartnerFee(pool, fee));
  expect(await m.pendingPartnerQuoteFee(pool)).toBe(0n);

  for (let i = 0; i < 20 && !(await m.curveState(pool)).complete; i++) {
    const swap = await client.pool.swap2({ owner: buyer.publicKey, pool: new PublicKey(pool), swapMode: SwapMode.PartialFill, amountIn: new BN(2 * LAMPORTS_PER_SOL), minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null });
    await sendAndConfirmTransaction(conn, swap, [buyer]);
  }
  expect(await m.curveState(pool)).toEqual({ migrated: false, complete: true });
  expect((await m.curveProgress(pool)).quoteReserve).toBeGreaterThanOrEqual((await m.curveProgress(pool)).threshold);
  expect(await m.findGraduatedPosition(config.publicKey.toBase58(), baseMint.publicKey.toBase58(), NATIVE_MINT)).toBeNull();

  await run(await m.buildMigrate(pool));
  expect((await m.curveState(pool)).migrated).toBe(true);
  const pos = await m.findGraduatedPosition(config.publicKey.toBase58(), baseMint.publicKey.toBase58(), NATIVE_MINT);
  expect(pos).not.toBeNull();
  await run(await m.buildClaimPositionFee(pos!));
});
