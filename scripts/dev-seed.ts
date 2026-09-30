// Seeds a local validator and Postgres with config keys, a Kamino global config and example launches,
// then writes .env.local and config-keys.json so `bun run dev` and `scripts/keeper-once.ts` work against them.
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { DynamicBondingCurveClient, SwapMode, deriveDbcPoolAuthority, deriveDammV2PoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Farms, GlobalConfigOption } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import { SQL } from "bun";
import BN from "bn.js";
import { SolanaChain, fromKitInstruction, kitSigner } from "../src/chain/solana";
import { MeteoraLive } from "../src/meteora/port";
import { buildQuantsConfig, configKeyName, FEE_TIERS_BPS } from "../src/meteora/config";
import { migrate } from "../src/db/migrate";
import { defaultSettings, saveSettings } from "../src/domain/settings";
import { prepareLaunch } from "../src/launch/prepare";
import { confirmLaunch } from "../src/launch/confirm";
import { NATIVE_MINT } from "../src/domain/types";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const DB = process.env.SEED_DATABASE_URL ?? "postgres://quants:quants@localhost:5434/quants";
const DAMM_CUSTOM = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";
const ENV_FILE = process.env.SEED_ENV_FILE ?? ".env.local";
const conn = new Connection(RPC, "confirmed");
const log = (m: string) => console.log(`[seed] ${m}`);

const keeper = Keypair.generate(), spill = Keypair.generate(), treasury = Keypair.generate();
const creator = Keypair.generate(), trader = Keypair.generate(), tester = Keypair.generate(), admin = Keypair.generate();
for (const k of [keeper, spill, treasury, creator, trader, tester, admin].map((x) => x.publicKey).concat([deriveDbcPoolAuthority(), deriveDammV2PoolAuthority()])) {
  await conn.confirmTransaction(await conn.requestAirdrop(k, 200 * LAMPORTS_PER_SOL));
}
const ours = await createMint(conn, keeper, keeper.publicKey, null, 6);
const rewards = {
  ZEC: await createMint(conn, keeper, keeper.publicKey, null, 8),
  CATE: await createMint(conn, keeper, keeper.publicKey, null, 6),
  ANSEM: await createMint(conn, keeper, keeper.publicKey, null, 6),
};
log("wallets and mints ready");

const client = DynamicBondingCurveClient.create(conn, "confirmed");
const configKeys: Record<string, string> = {};
for (const q of [{ mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 85 }, { mint: ours.toBase58(), decimals: 6, migrationQuoteThreshold: 100_000 }]) {
  for (const bps of FEE_TIERS_BPS) {
    const config = Keypair.generate();
    await sendAndConfirmTransaction(conn, await client.partner.createConfig({
      config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey, quoteMint: new PublicKey(q.mint), payer: keeper.publicKey,
      ...buildQuantsConfig(bps, q),
    }), [keeper, config]);
    configKeys[configKeyName(q.mint, bps)] = config.publicKey.toBase58();
  }
}
await Bun.write("config-keys.json", JSON.stringify(configKeys, null, 2));
const farms = new Farms(createSolanaRpc(RPC));
const gc = Keypair.generate();
await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.updateGlobalConfigIx(kitSigner(keeper), address(gc.publicKey.toBase58()), GlobalConfigOption.SetTreasuryFeeBps, "0", "number"))), [keeper]);
log("8 config keys and the Kamino global config created");

const sql = new SQL({ url: DB, max: 4 });
await sql.unsafe("drop schema if exists public cascade; create schema public;");
await migrate(sql);
await saveSettings(sql, defaultSettings(ours.toBase58()), "seed");

const chain = new SolanaChain(conn, keeper, spill);
const meteora = new MeteoraLive(chain, DAMM_CUSTOM);
const deps = { sql, meteora, configKeys, ourtokenMint: ours.toBase58(), keeperAddress: keeper.publicKey.toBase58(), isVerified: async () => true,
  tokenProgramOf: async (m: string) => (await conn.getAccountInfo(new PublicKey(m)))!.owner.toBase58() };

async function launch(name: string, symbol: string, basket: { mint: PublicKey; symbol: string; decimals: number; weightBps: number }[]) {
  const p = await prepareLaunch(deps, {
    name, symbol, uri: `https://example.com/${symbol}.json`, creator: creator.publicKey.toBase58(), quoteMint: NATIVE_MINT, feeTierBps: 200,
    basket: basket.map((b) => ({ ...b, mint: b.mint.toBase58() })), devBuyQuoteAmount: "500000000",
  });
  const tx = Transaction.from(Buffer.from(p.transaction, "base64"));
  tx.partialSign(creator);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  await confirmLaunch({ sql, conn, meteora, spillWallet: spill.publicKey }, { signature: sig, mint: p.mint });
  return p;
}
const buy = async (who: Keypair, pool: string, sol: number) =>
  sendAndConfirmTransaction(conn, await client.pool.swap2({ owner: who.publicKey, pool: new PublicKey(pool), swapMode: SwapMode.PartialFill, amountIn: new BN(sol * LAMPORTS_PER_SOL), minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null }), [who]);

const cat = await launch("Cat Coin", "CAT", [
  { mint: rewards.ZEC, symbol: "ZEC", decimals: 8, weightBps: 5000 },
  { mint: rewards.CATE, symbol: "CATE", decimals: 6, weightBps: 3000 },
  { mint: rewards.ANSEM, symbol: "ANSEM", decimals: 6, weightBps: 2000 },
]);
const dog = await launch("Dog Wif Basket", "DOG", [{ mint: rewards.ZEC, symbol: "ZEC", decimals: 8, weightBps: 10_000 }]);
for (let i = 0; i < 12; i++) await buy(trader, cat.pool, 2);
for (const who of [tester, admin]) await buy(who, cat.pool, 3);
for (let i = 0; i < 4; i++) await buy(trader, dog.pool, 1);
log(`launched CAT ${cat.mint} and DOG ${dog.mint}, traded both`);

// Test wallet also gets some OURTOKEN so OURTOKEN pairs can be tried by hand.
const testerOurs = await getOrCreateAssociatedTokenAccount(conn, keeper, ours, tester.publicKey);
await mintTo(conn, keeper, ours, testerOurs.address, keeper, 1_000_000_000_000n);

const env = {
  DATABASE_URL: DB,
  RPC_URL: RPC,
  KEEPER_KEYPAIR: JSON.stringify(Array.from(keeper.secretKey)),
  SPILL_KEYPAIR: JSON.stringify(Array.from(spill.secretKey)),
  KEEPER_ADDRESS: keeper.publicKey.toBase58(),
  SPILL_ADDRESS: spill.publicKey.toBase58(),
  TREASURY_ADDRESS: treasury.publicKey.toBase58(),
  OURTOKEN_MINT: ours.toBase58(),
  KAMINO_GLOBAL_CONFIG: gc.publicKey.toBase58(),
  DAMM_V2_MIGRATION_CONFIG: DAMM_CUSTOM,
  CONFIG_KEYS_PATH: "config-keys.json",
  PINATA_JWT: "stub",
  DEV_UPLOADS_BASE: "http://localhost:3000/dev-uploads",
  ALLOW_LOCAL_URIS: "1",
  ADMIN_WALLETS: [admin.publicKey.toBase58(), tester.publicKey.toBase58()].join(","),
  ADMIN_SESSION_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
  LOCAL_REWARD_MINTS: Object.values(rewards).map((m) => m.toBase58()).join(","),
  LOCAL_TOKEN_LIST: JSON.stringify(Object.entries(rewards).map(([symbol, m]) => ({ mint: m.toBase58(), symbol, name: symbol, icon: null, decimals: symbol === "ZEC" ? 8 : 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }))),
  NEXT_PUBLIC_RPC_URL: RPC,
  NEXT_PUBLIC_OURTOKEN_MINT: ours.toBase58(),
  NEXT_PUBLIC_OURTOKEN_SYMBOL: "QNT",
  NEXT_PUBLIC_SOL_GRADUATION: "85",
  NEXT_PUBLIC_OURTOKEN_GRADUATION: "100000",
  NEXT_PUBLIC_TEST_WALLET_SECRET: JSON.stringify(Array.from(tester.secretKey)),
  E2E_ADMIN_SECRET: JSON.stringify(Array.from(admin.secretKey)),
  SEED_CAT_MINT: cat.mint,
  SEED_DOG_MINT: dog.mint,
};
await Bun.write(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}='${v}'`).join("\n") + "\n");
log(`wrote ${ENV_FILE} and config-keys.json`);
process.exit(0);
