// Seeds a local validator and Postgres with config keys, a Kamino global config and example launches,
// then writes .env.local and config-keys.json so `bun run dev` and `scripts/keeper-once.ts` work against them.
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { DynamicBondingCurveClient, SwapMode, deriveDbcPoolAuthority, deriveDammV2PoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Farms, GlobalConfigOption } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import { SQL } from "bun";
import BN from "bn.js";
import { SolanaChain, fromKitInstruction, kitSigner } from "../src/chain/solana";
import { MeteoraLive } from "../src/meteora/port";
import { configKeyName, FEE_TIERS_BPS } from "../src/meteora/config";
import { createConfigTx } from "../src/meteora/create-config";
import { migrate } from "../src/db/migrate";
import { defaultSettings, saveSettings } from "../src/domain/settings";
import { prepareLaunch } from "../src/launch/prepare";
import { confirmLaunch } from "../src/launch/confirm";
import { NATIVE_MINT } from "../src/domain/types";
import { quoteCoins } from "../src/domain/quotes";

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
// Stand-ins for the mainnet quote coins, which do not exist on a local validator.
const localQuotes: Record<string, PublicKey> = {
  USDC: await createMint(conn, keeper, keeper.publicKey, null, 6),
  USDT: await createMint(conn, keeper, keeper.publicKey, null, 6),
  JUP: await createMint(conn, keeper, keeper.publicKey, null, 6),
};
const quoteEnv = {
  OURTOKEN_MINT: ours.toBase58(), OURTOKEN_SYMBOL: "QUANTS", OURTOKEN_DECIMALS: "6", OURTOKEN_GRADUATION: "100000",
  QUOTE_MINTS: JSON.stringify(Object.fromEntries(Object.entries(localQuotes).map(([k, v]) => [k, v.toBase58()]))),
};
// Token-2022 stand-ins for stock pairs; the web app lists them through LOCAL_STOCKS instead of the issuers' lists.
const t22Mint = (decimals: number) => createMint(conn, keeper, keeper.publicKey, null, decimals, undefined, { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
const localStocks = [
  { mint: await t22Mint(8), issuer: "xstocks", symbol: "NVDAx", name: "NVIDIA xStock", icon: null, decimals: 8, graduation: 60 },
  { mint: await t22Mint(6), issuer: "backpack", symbol: "SPCX.US", name: "SpaceX", icon: null, decimals: 6, graduation: 100 },
];
const rewards = {
  ZEC: await createMint(conn, keeper, keeper.publicKey, null, 8),
  CATE: await createMint(conn, keeper, keeper.publicKey, null, 6),
  ANSEM: await createMint(conn, keeper, keeper.publicKey, null, 6),
};
log("wallets and mints ready");

const client = DynamicBondingCurveClient.create(conn, "confirmed");
const configKeys: Record<string, string> = {};
const pairSpecs = [
  ...quoteCoins(quoteEnv).map((c) => ({ mint: c.mint, decimals: c.decimals, migrationQuoteThreshold: c.graduation })),
  ...localStocks.map((c) => ({ mint: c.mint.toBase58(), decimals: c.decimals, migrationQuoteThreshold: c.graduation })),
];
for (const q of pairSpecs) {
  for (const bps of FEE_TIERS_BPS) {
    const config = Keypair.generate();
    await sendAndConfirmTransaction(conn, await createConfigTx(client, conn, keeper.publicKey, config.publicKey, bps, q), [keeper, config]);
    configKeys[configKeyName(q.mint, bps)] = config.publicKey.toBase58();
  }
}
await Bun.write("config-keys.json", JSON.stringify(configKeys, null, 2));
const farms = new Farms(createSolanaRpc(RPC));
const gc = Keypair.generate();
await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.updateGlobalConfigIx(kitSigner(keeper), address(gc.publicKey.toBase58()), GlobalConfigOption.SetTreasuryFeeBps, "0", "number"))), [keeper]);
log(`${Object.keys(configKeys).length} config keys and the Kamino global config created`);

const sql = new SQL({ url: DB, max: 4 });
await sql.unsafe("drop schema if exists public cascade; create schema public;");
await migrate(sql);
await saveSettings(sql, defaultSettings(ours.toBase58()), "seed");

const chain = new SolanaChain(conn, keeper, spill);
const meteora = new MeteoraLive(chain, DAMM_CUSTOM);
const stockMints = localStocks.map((st) => st.mint.toBase58());
const deps = { sql, meteora, configKeys, quoteMints: [NATIVE_MINT, ours.toBase58(), ...stockMints], tradingOnlyMints: stockMints, isVerified: async () => true,
  tokenProgramOf: async (m: string) => (await conn.getAccountInfo(new PublicKey(m)))!.owner.toBase58() };

async function launch(name: string, symbol: string, basket: { mint: PublicKey; symbol: string; decimals: number; weightBps: number }[], quoteMint = NATIVE_MINT) {
  const p = await prepareLaunch(deps, {
    name, symbol, uri: `https://example.com/${symbol}.json`, creator: creator.publicKey.toBase58(), quoteMint, feeTierBps: 200,
    basket: basket.map((b) => ({ ...b, mint: b.mint.toBase58() })), devBuyQuoteAmount: quoteMint === NATIVE_MINT ? "500000000" : "0",
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
// Enough buy and sell volume on CAT for its stakers' share to pay for its farms, so the next keeper run opens staking. DOG stays closed.
const traderCat = getAssociatedTokenAddressSync(new PublicKey(cat.mint), trader.publicKey);
const held = async () => BigInt((await conn.getTokenAccountBalance(traderCat)).value.amount);
for (let i = 0; i < 4; i++) {
  const before = await held();
  await buy(trader, cat.pool, 5);
  const got = (await held()) - before;
  await sendAndConfirmTransaction(conn, await client.pool.swap2({ owner: trader.publicKey, pool: new PublicKey(cat.pool), swapMode: SwapMode.PartialFill, amountIn: new BN(got.toString()), minimumAmountOut: new BN(0), swapBaseForQuote: true, referralTokenAccount: null }), [trader]);
}
log(`launched CAT ${cat.mint} and DOG ${dog.mint}, traded both`);
const stock = await launch("Stock Cat", "SCAT", [], stockMints[0]!);
log(`launched SCAT ${stock.mint}, trading only against the NVDAx stand-in`);

// Test wallet also gets each non-SOL quote coin so those pairs can be tried by hand.
for (const m of [ours, ...Object.values(localQuotes)]) {
  const acct = await getOrCreateAssociatedTokenAccount(conn, keeper, m, tester.publicKey);
  await mintTo(conn, keeper, m, acct.address, keeper, 1_000_000_000_000n);
}
for (const st of localStocks) {
  const acct = await getOrCreateAssociatedTokenAccount(conn, keeper, st.mint, tester.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(conn, keeper, st.mint, acct.address, keeper, 1_000n * 10n ** BigInt(st.decimals), [], undefined, TOKEN_2022_PROGRAM_ID);
}

const env = {
  DATABASE_URL: DB,
  RPC_URL: RPC,
  KEEPER_KEYPAIR: JSON.stringify(Array.from(keeper.secretKey)),
  SPILL_KEYPAIR: JSON.stringify(Array.from(spill.secretKey)),
  KEEPER_ADDRESS: keeper.publicKey.toBase58(),
  SPILL_ADDRESS: spill.publicKey.toBase58(),
  TREASURY_ADDRESS: treasury.publicKey.toBase58(),
  ...quoteEnv,
  KAMINO_GLOBAL_CONFIG: gc.publicKey.toBase58(),
  DAMM_V2_MIGRATION_CONFIG: DAMM_CUSTOM,
  CONFIG_KEYS_PATH: "config-keys.json",
  PINATA_JWT: "stub",
  DEV_UPLOADS_BASE: "http://localhost:3000/api/dev-uploads",
  ALLOW_LOCAL_URIS: "1",
  ADMIN_WALLETS: [admin.publicKey.toBase58(), tester.publicKey.toBase58()].join(","),
  ADMIN_SESSION_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
  LOCAL_REWARD_MINTS: Object.values(rewards).map((m) => m.toBase58()).join(","),
  LOCAL_STOCKS: JSON.stringify(localStocks.map((st) => ({ mint: st.mint.toBase58(), issuer: st.issuer, symbol: st.symbol, name: st.name, icon: st.icon }))),
  LOCAL_TOKEN_LIST: JSON.stringify(Object.entries(rewards).map(([symbol, m]) => ({ mint: m.toBase58(), symbol, name: symbol, icon: null, decimals: symbol === "ZEC" ? 8 : 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }))),
  NEXT_PUBLIC_RPC_URL: RPC,
  NEXT_PUBLIC_OURTOKEN_MINT: ours.toBase58(),
  NEXT_PUBLIC_OURTOKEN_SYMBOL: "QUANTS",
  NEXT_PUBLIC_SOL_GRADUATION: "85",
  NEXT_PUBLIC_OURTOKEN_GRADUATION: "100000",
  NEXT_PUBLIC_TEST_WALLET_SECRET: JSON.stringify(Array.from(tester.secretKey)),
  E2E_ADMIN_SECRET: JSON.stringify(Array.from(admin.secretKey)),
  SEED_CAT_MINT: cat.mint,
  SEED_DOG_MINT: dog.mint,
  SEED_STOCK_MINT: stock.mint,
};
await Bun.write(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}='${v}'`).join("\n") + "\n");
log(`wrote ${ENV_FILE} and config-keys.json`);
process.exit(0);
