import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DynamicBondingCurveClient, deriveDbcPoolAuthority, deriveDammV2PoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { SolanaChain } from "../../src/chain/solana";
import { MeteoraLive } from "../../src/meteora/port";
import { TradeLive, type TradeTarget } from "../../src/meteora/trade";
import { buildQuantsConfig } from "../../src/meteora/config";
import { NATIVE_MINT } from "../../src/domain/types";

const DAMM_CUSTOM = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";
const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const up = await conn.getAccountInfo(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN")).then((a) => a !== null, () => false);

async function signSend(base64: string, kp: Keypair) {
  const tx = Transaction.from(Buffer.from(base64, "base64"));
  tx.partialSign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const r = await conn.confirmTransaction(sig, "confirmed");
  expect(r.value.err).toBeNull();
}
const bal = async (mint: PublicKey, owner: PublicKey) => BigInt((await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, owner)).catch(() => ({ value: { amount: "0" } }))).value.amount);

test.skipIf(!up)("buy and sell on the curve, then buy on the graduated pool", async () => {
  const keeper = Keypair.generate(), creator = Keypair.generate(), user = Keypair.generate();
  for (const k of [keeper.publicKey, creator.publicKey, user.publicKey, deriveDbcPoolAuthority(), deriveDammV2PoolAuthority()]) {
    await conn.confirmTransaction(await conn.requestAirdrop(k, 50 * LAMPORTS_PER_SOL));
  }
  const chain = new SolanaChain(conn, keeper, Keypair.generate());
  const m = new MeteoraLive(chain, DAMM_CUSTOM);
  const trade = new TradeLive(conn);
  const config = Keypair.generate();
  const client = DynamicBondingCurveClient.create(conn);
  await sendAndConfirmTransaction(conn, await client.partner.createConfig({
    config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey, quoteMint: new PublicKey(NATIVE_MINT), payer: keeper.publicKey,
    ...buildQuantsConfig(200, { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 5 }),
  }), [keeper, config]);
  const { tx, baseMint, pool } = await m.buildLaunchTx({
    name: "Cat", symbol: "CAT", uri: "https://example.com/c.json", creator: creator.publicKey.toBase58(), configKey: config.publicKey.toBase58(),
    quoteMint: NATIVE_MINT, launchFeeLamports: 0n, feeReceiver: keeper.publicKey.toBase58(), devBuyQuoteAmount: 0n, devBuyMinOut: 0n,
  });
  tx.partialSign(creator);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
  const target: TradeTarget = { pool, dammPool: null, baseMint: baseMint.publicKey.toBase58(), quoteMint: NATIVE_MINT, baseDecimals: 6, quoteDecimals: 9 };
  const owner = user.publicKey.toBase58();

  const q = await trade.quote(target, "buy", 1_000_000_000n, 100);
  expect(q.venue).toBe("curve");
  expect(q.amountOut).toBeGreaterThan(0n);
  expect(q.minOut).toBeLessThan(q.amountOut);
  await signSend(await trade.buildSwapTx(target, "buy", 1_000_000_000n, q.minOut, owner), user);
  const got = await bal(baseMint.publicKey, user.publicKey);
  expect(got).toBeGreaterThanOrEqual(q.minOut);

  const solBefore = await conn.getBalance(user.publicKey);
  const qs = await trade.quote(target, "sell", got / 2n, 100);
  await signSend(await trade.buildSwapTx(target, "sell", got / 2n, qs.minOut, owner), user);
  expect(await bal(baseMint.publicKey, user.publicKey)).toBe(got - got / 2n);
  expect(await conn.getBalance(user.publicKey)).toBeGreaterThan(solBefore);

  const big = await trade.quote(target, "buy", 20_000_000_000n, 100);
  expect(big.filledIn).toBeLessThan(20_000_000_000n);
  await signSend(await trade.buildSwapTx(target, "buy", 20_000_000_000n, big.minOut, owner), user);
  expect((await m.curveState(pool)).complete).toBe(true);
  const mig = await m.buildMigrate(pool);
  await mig.send();
  await chain.waitForConfirmation(mig.signature, mig.lastValidBlockHeight);
  const pos = (await m.findGraduatedPosition(config.publicKey.toBase58(), target.baseMint, NATIVE_MINT))!;
  const graduated = { ...target, dammPool: pos.dammPool };

  const before = await bal(baseMint.publicKey, user.publicKey);
  const qd = await trade.quote(graduated, "buy", 100_000_000n, 100);
  expect(qd.venue).toBe("damm");
  await signSend(await trade.buildSwapTx(graduated, "buy", 100_000_000n, qd.minOut, owner), user);
  expect(await bal(baseMint.publicKey, user.publicKey)).toBeGreaterThan(before);
});
