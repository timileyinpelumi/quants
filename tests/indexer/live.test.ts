import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient, deriveDbcPoolAuthority, deriveDammV2PoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { SolanaChain } from "../../src/chain/solana";
import { MeteoraLive } from "../../src/meteora/port";
import { TradeLive, type TradeTarget } from "../../src/meteora/trade";
import { buildQuantsConfig } from "../../src/meteora/config";
import { NATIVE_MINT } from "../../src/domain/types";
import { RpcHistory } from "../../src/indexer/history";
import type { IndexedTx } from "../../src/indexer/run";

const DAMM_CUSTOM = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";
const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const up = await conn.getAccountInfo(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN")).then((a) => a !== null, () => false);

async function signSend(base64: string, kp: Keypair) {
  const tx = Transaction.from(Buffer.from(base64, "base64"));
  tx.partialSign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

test.skipIf(!up)("reads buys and sells on the curve and on the graduated pool from chain history", async () => {
  const keeper = Keypair.generate(), creator = Keypair.generate(), user = Keypair.generate();
  for (const k of [keeper.publicKey, creator.publicKey, user.publicKey, deriveDbcPoolAuthority(), deriveDammV2PoolAuthority()]) {
    await conn.confirmTransaction(await conn.requestAirdrop(k, 50 * LAMPORTS_PER_SOL));
  }
  const chain = new SolanaChain(conn, keeper, Keypair.generate());
  const m = new MeteoraLive(chain, DAMM_CUSTOM);
  const trade = new TradeLive(conn);
  const config = Keypair.generate();
  await sendAndConfirmTransaction(conn, await DynamicBondingCurveClient.create(conn).partner.createConfig({
    config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey, quoteMint: new PublicKey(NATIVE_MINT), payer: keeper.publicKey,
    ...buildQuantsConfig(200, { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 5 }),
  }), [keeper, config]);
  const { tx, baseMint, pool } = await m.buildLaunchTx({
    name: "Cat", symbol: "CAT", uri: "https://example.com/c.json", creator: creator.publicKey.toBase58(), configKey: config.publicKey.toBase58(),
    quoteMint: NATIVE_MINT, launchFeeLamports: 0n, feeReceiver: keeper.publicKey.toBase58(), devBuyQuoteAmount: 0n, devBuyMinOut: 0n,
  });
  tx.partialSign(creator);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");
  const t: TradeTarget = { pool, dammPool: null, baseMint: baseMint.publicKey.toBase58(), quoteMint: NATIVE_MINT, baseDecimals: 6, quoteDecimals: 9 };
  const owner = user.publicKey.toBase58();

  const qb = await trade.quote(t, "buy", 1_000_000_000n, 100);
  const buySig = await signSend(await trade.buildSwapTx(t, "buy", 1_000_000_000n, qb.minOut, owner), user);
  const qs = await trade.quote(t, "sell", qb.amountOut / 2n, 100);
  const sellSig = await signSend(await trade.buildSwapTx(t, "sell", qb.amountOut / 2n, qs.minOut, owner), user);

  const h = new RpcHistory(conn);
  const sigs = (await h.signaturesSince(pool, null)).map((x) => x.signature);
  expect(sigs.indexOf(buySig)).toBeLessThan(sigs.indexOf(sellSig));
  const txs = await h.transactions([buySig, sellSig], pool);
  const [buy, sell] = txs as [IndexedTx, IndexedTx];
  expect([buy.signature, sell.signature]).toEqual([buySig, sellSig]);
  expect(buy.trader).toBe(owner);
  expect(buy.swaps).toHaveLength(1);
  expect(buy.swaps[0]).toMatchObject({ venue: "curve", side: "buy", quoteAmount: 1_000_000_000n });
  expect(buy.swaps[0]!.baseAmount).toBe(qb.amountOut);
  expect(buy.swaps[0]!.curve!.threshold).toBe(5_000_000_000n);
  expect(buy.swaps[0]!.curve!.reserve).toBeGreaterThan(0n);
  expect(sell.swaps[0]).toMatchObject({ venue: "curve", side: "sell", baseAmount: qb.amountOut / 2n });
  expect(sell.swaps[0]!.quoteAmount).toBeGreaterThan(0n);
  expect(sell.swaps[0]!.sqrtPrice).toBeLessThan(buy.swaps[0]!.sqrtPrice);
  expect(await h.signaturesSince(pool, sellSig)).toEqual([]);
  expect((await h.signaturesSince(pool, buySig)).map((x) => x.signature)).toEqual([sellSig]);
  expect(((await h.transactions([buySig], "11111111111111111111111111111111"))[0] as IndexedTx).swaps).toEqual([]);
  expect(buy.slot).toBeLessThanOrEqual(sell.slot);
  expect(await h.transactions(["1111111111111111111111111111111111111111111111111111111111111111"], pool)).toEqual([
    { signature: "1111111111111111111111111111111111111111111111111111111111111111", missing: true },
  ]);

  const big = await trade.quote(t, "buy", 20_000_000_000n, 100);
  await signSend(await trade.buildSwapTx(t, "buy", 20_000_000_000n, big.minOut, owner), user);
  const mig = await m.buildMigrate(pool);
  await mig.send();
  await chain.waitForConfirmation(mig.signature, mig.lastValidBlockHeight);
  const pos = (await m.findGraduatedPosition(config.publicKey.toBase58(), t.baseMint, NATIVE_MINT))!;
  const g = { ...t, dammPool: pos.dammPool };
  const qd = await trade.quote(g, "buy", 100_000_000n, 100);
  const dSig = await signSend(await trade.buildSwapTx(g, "buy", 100_000_000n, qd.minOut, owner), user);

  const [d] = (await h.transactions([dSig], pos.dammPool)) as IndexedTx[];
  expect(d!.swaps).toHaveLength(1);
  expect(d!.swaps[0]).toMatchObject({ venue: "damm", side: "buy", quoteAmount: 100_000_000n });
  expect(d!.swaps[0]!.baseAmount).toBeGreaterThan(0n);
  expect(d!.swaps[0]!.curve).toBeUndefined();
}, 240_000);
