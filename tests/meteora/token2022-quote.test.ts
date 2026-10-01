import { test, expect } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, createInitializeMintInstruction, getMintLen, getOrCreateAssociatedTokenAccount, mintTo,
} from "@solana/spl-token";
import { DynamicBondingCurveClient, deriveTokenBadgeAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { SolanaChain } from "../../src/chain/solana";
import { MeteoraLive, quoteTokenBadge } from "../../src/meteora/port";
import { createConfigTx } from "../../src/meteora/create-config";
import { mintAccount, mintData } from "../helpers/mint-data";

const DAMM_CUSTOM = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";

test("token badge is passed only for Token-2022 quotes whose badge exists", async () => {
  const t22 = Keypair.generate().publicKey, plain = Keypair.generate().publicKey, classic = Keypair.generate().publicKey;
  const badge = deriveTokenBadgeAddress(t22);
  const accounts = new Map<string, unknown>([
    [t22.toBase58(), mintAccount(mintData(8))], [plain.toBase58(), mintAccount(mintData(8))],
    [classic.toBase58(), mintAccount(mintData(6), false)], [badge.toBase58(), { owner: PublicKey.default }],
  ]);
  const conn = { getAccountInfo: async (k: PublicKey) => accounts.get(k.toBase58()) ?? null } as any;
  expect((await quoteTokenBadge(conn, t22))?.toBase58()).toBe(badge.toBase58());
  expect(await quoteTokenBadge(conn, plain)).toBeUndefined();
  expect(await quoteTokenBadge(conn, classic)).toBeUndefined();
});

const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const up = await conn.getAccountInfo(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN")).then((a) => a !== null, () => false);

test.skipIf(!up)("Token-2022 quote: config, launch with a first buy, partner fee claim and payout", async () => {
  const keeper = Keypair.generate(), creator = Keypair.generate();
  for (const k of [keeper, creator]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 20 * LAMPORTS_PER_SOL));
  const quote = Keypair.generate();
  const len = getMintLen([]);
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: keeper.publicKey, newAccountPubkey: quote.publicKey, space: len, lamports: await conn.getMinimumBalanceForRentExemption(len), programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMintInstruction(quote.publicKey, 8, keeper.publicKey, null, TOKEN_2022_PROGRAM_ID),
  ), [keeper, quote]);
  const creatorAta = await getOrCreateAssociatedTokenAccount(conn, keeper, quote.publicKey, creator.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(conn, keeper, quote.publicKey, creatorAta.address, keeper, 1_000n * 10n ** 8n, [], undefined, TOKEN_2022_PROGRAM_ID);

  const chain = new SolanaChain(conn, keeper, Keypair.generate());
  const m = new MeteoraLive(chain, DAMM_CUSTOM);
  const config = Keypair.generate();
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  await sendAndConfirmTransaction(conn, await createConfigTx(client, conn, keeper.publicKey, config.publicKey, 200,
    { mint: quote.publicKey.toBase58(), decimals: 8, migrationQuoteThreshold: 50 }), [keeper, config]);
  expect(await m.configThreshold(config.publicKey.toBase58())).toBe(50n * 10n ** 8n);

  const { tx, pool } = await m.buildLaunchTx({
    name: "Stock Cat", symbol: "SCAT", uri: "https://example.com/scat.json", creator: creator.publicKey.toBase58(),
    configKey: config.publicKey.toBase58(), quoteMint: quote.publicKey.toBase58(), devBuyQuoteAmount: 10n ** 8n, devBuyMinOut: 0n,
  });
  tx.partialSign(creator);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), "confirmed");

  const fee = await m.pendingPartnerQuoteFee(pool);
  expect(fee).toBeGreaterThan(0n);
  const claim = await m.buildClaimPartnerFee(pool, fee);
  await claim.send();
  expect(await chain.waitForConfirmation(claim.signature, claim.lastValidBlockHeight)).toBe("confirmed");
  expect(await chain.received(claim.signature, keeper.publicKey.toBase58(), quote.publicKey.toBase58())).toBe(fee);
  expect(await chain.balance(keeper.publicKey.toBase58(), quote.publicKey.toBase58())).toBe(fee);

  const pay = await chain.buildTransfer(quote.publicKey.toBase58(), creator.publicKey.toBase58(), fee);
  await pay.send();
  expect(await chain.waitForConfirmation(pay.signature, pay.lastValidBlockHeight)).toBe("confirmed");
  expect(await chain.balance(keeper.publicKey.toBase58(), quote.publicKey.toBase58())).toBe(0n);
});
