import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, createMintToInstruction, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { DynamicBondingCurveClient, SwapMode, deriveDbcPoolAuthority, deriveDammV2PoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Farms, GlobalConfigOption } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc, none } from "@solana/kit";
import { SQL } from "bun";
import BN from "bn.js";
import Decimal from "decimal.js";
import { SolanaChain, fromKitInstruction, kitSigner } from "../src/chain/solana";
import { MeteoraLive } from "../src/meteora/port";
import { KaminoBackend } from "../src/staking/kamino";
import type { JupiterPort, SwapQuote } from "../src/jupiter/port";
import { buildQuantsConfig, configKeyName } from "../src/meteora/config";
import { migrate } from "../src/db/migrate";
import { defaultSettings, saveSettings } from "../src/domain/settings";
import { prepareLaunch } from "../src/launch/prepare";
import { confirmLaunch } from "../src/launch/confirm";
import { runKeeper } from "../src/keeper/run";
import { NATIVE_MINT } from "../src/domain/types";
import { staticConfigs } from "../src/launch/config-keys";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const DB = process.env.E2E_DATABASE_URL ?? "postgres://quants:quants@localhost:5434/quants_test";
const DAMM_CUSTOM = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";
const conn = new Connection(RPC, "confirmed");
const log = (step: string, v: unknown = "") => console.log(`[e2e] ${step}`, v);

const keeper = Keypair.generate(), spill = Keypair.generate(), creator = Keypair.generate(), trader = Keypair.generate(), staker = Keypair.generate();
const treasury = Keypair.generate();
for (const k of [keeper.publicKey, spill.publicKey, creator.publicKey, trader.publicKey, staker.publicKey, treasury.publicKey, deriveDbcPoolAuthority(), deriveDammV2PoolAuthority()]) {
  await conn.confirmTransaction(await conn.requestAirdrop(k, 100 * LAMPORTS_PER_SOL));
}
const ours = await createMint(conn, keeper, keeper.publicKey, null, 6);
const zec = await createMint(conn, keeper, keeper.publicKey, null, 8);
log("1. wallets funded, OURTOKEN and ZEC mints created");

const chain = new SolanaChain(conn, keeper, spill);
const client = DynamicBondingCurveClient.create(conn, "confirmed");
const config = Keypair.generate();
await sendAndConfirmTransaction(conn, await client.partner.createConfig({
  config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey, quoteMint: new PublicKey(NATIVE_MINT), payer: keeper.publicKey,
  ...buildQuantsConfig(200, { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 85 }),
}), [keeper, config]);
const configKeys = { [configKeyName(NATIVE_MINT, 200)]: config.publicKey.toBase58() };
const farmsSdk = new Farms(createSolanaRpc(RPC));
const gc = Keypair.generate();
await sendAndConfirmTransaction(conn, new Transaction().add(...(await farmsSdk.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farmsSdk.updateGlobalConfigIx(kitSigner(keeper), address(gc.publicKey.toBase58()), GlobalConfigOption.SetTreasuryFeeBps, "0", "number"))), [keeper]);
log("2. DBC config and Kamino global config created");

const sql = new SQL({ url: DB, max: 4 });
await sql.unsafe("drop schema if exists public cascade; create schema public;");
await migrate(sql);
await saveSettings(sql, defaultSettings(ours.toBase58()), "e2e");
log("3. database migrated, default settings saved");

const meteora = new MeteoraLive(chain, DAMM_CUSTOM);
const prepared = await prepareLaunch(
  { sql, meteora, configFor: staticConfigs(configKeys), quoteMints: [NATIVE_MINT, ours.toBase58()], isVerified: async () => true,
    tokenProgramOf: async (m: string) => (await conn.getAccountInfo(new PublicKey(m)))!.owner.toBase58() },
  { name: "Cat", symbol: "CAT", uri: "https://example.com/cat.json", creator: creator.publicKey.toBase58(), quoteMint: NATIVE_MINT, feeTierBps: 200,
    basket: [{ mint: zec.toBase58(), weightBps: 10_000 }], devBuyQuoteAmount: "100000000" },
);
const launchTx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
launchTx.partialSign(creator);
const launchSig = await conn.sendRawTransaction(launchTx.serialize());
await conn.confirmTransaction(launchSig, "confirmed");
const launchId = await confirmLaunch({ sql, conn, meteora, spillWallet: spill.publicKey }, { signature: launchSig, mint: prepared.mint });
log("4. launch confirmed", { launchId, mint: prepared.mint, pool: prepared.pool });

const swap = async (who: Keypair, amount: BN, sell: boolean) =>
  sendAndConfirmTransaction(conn, await client.pool.swap2({ owner: who.publicKey, pool: new PublicKey(prepared.pool), swapMode: SwapMode.PartialFill, amountIn: amount, minimumAmountOut: new BN(0), swapBaseForQuote: sell, referralTokenAccount: null }), [who]);
for (let i = 0; i < 20; i++) await swap(trader, new BN(LAMPORTS_PER_SOL / 2), false);
await swap(staker, new BN(LAMPORTS_PER_SOL), false);
// Staking opens once the stakers' share pays for the farms, so add buy and sell volume past that.
const traderCat = getAssociatedTokenAddressSync(new PublicKey(prepared.mint), trader.publicKey);
for (let i = 0; i < 5; i++) {
  const before = BigInt((await conn.getTokenAccountBalance(traderCat)).value.amount);
  await swap(trader, new BN(5 * LAMPORTS_PER_SOL), false);
  const got = BigInt((await conn.getTokenAccountBalance(traderCat)).value.amount) - before;
  await swap(trader, new BN(got.toString()), true);
}
log("5. 21 buys and 5 round trips on the curve");

// Local stand-in for Jupiter: mints ZEC to the keeper 1:1 against SOL base units.
const jupiter: JupiterPort = {
  async quote(_i, _o, amount) { return { inAmount: amount, outAmount: amount / 10n, priceImpactBps: 0, raw: null }; },
  async buildSwap(q: SwapQuote) {
    const ata = getAssociatedTokenAddressSync(zec, keeper.publicKey);
    return chain.signLegacy(new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, ata, keeper.publicKey, zec),
      createMintToInstruction(zec, ata, keeper.publicKey, q.outAmount),
    ), []);
  },
  async isVerified() { return true; },
  async searchVerified() { return []; },
  async popularVerified() { return []; },
  async buildUnsignedSwap() { throw new Error("not used locally"); },
};
const deps = {
  sql, chain, meteora, jupiter,
  staking: new KaminoBackend(chain, RPC, gc.publicKey.toBase58()),
  wallets: { keeper: keeper.publicKey.toBase58(), spill: spill.publicKey.toBase58(), treasury: treasury.publicKey.toBase58() },
};

const show = async (label: string) => {
  const d = await sql`select kind, status, count(*)::int n from distributions group by 1, 2 order by 1, 2`;
  const e = await sql`select bucket, mint, amount::text from escrow where amount > 0 order by 1, 2`;
  log(label, { distributions: d.map((r: any) => `${r.kind}:${r.status}x${r.n}`), escrow: e.map((r: any) => `${r.bucket}:${r.mint.slice(0, 6)}=${r.amount}`) });
};

let r = await runKeeper(deps);
log("6. keeper run 1", r.errors);
await show("   after run 1");

const [tier30] = await sql`select farm from stake_tiers where launch_id = ${launchId} and tier_id = '30d'`;
const farm = address(tier30.farm);
await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farmsSdk.createNewUserIx(kitSigner(staker), farm))), [staker]);
const stakerCat = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(prepared.mint), staker.publicKey));
await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farmsSdk.stakeIx(kitSigner(staker), farm, new Decimal(stakerCat.value.amount), address(prepared.mint), none()))), [staker]);
log("7. staker staked in the 30d farm", stakerCat.value.amount);

for (let i = 0; i < 5; i++) await swap(trader, new BN(LAMPORTS_PER_SOL / 2), false);
r = await runKeeper(deps);
log("8. keeper run 2", r.errors);
await show("   after run 2");

const supplyBefore = (await getMint(conn, new PublicKey(prepared.mint))).supply;
const [us] = await farmsSdk.getUserStatesForUserAndFarm(address(staker.publicKey.toBase58()), farm);
await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farmsSdk.unstakeIx(kitSigner(staker), farm, new Decimal(us!.userState.activeStakeScaled.toString()), none()))), [staker]);
await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farmsSdk.withdrawUnstakedDepositIx(kitSigner(staker), us!.key, farm, address(prepared.mint)))), [staker]);
log("9. staker exited early");

r = await runKeeper(deps);
log("10. keeper run 3", r.errors);
await show("   after run 3");
const supplyAfter = (await getMint(conn, new PublicKey(prepared.mint))).supply;
const [burn] = await sql`select detail->>'amount' as amount from distributions where kind = 'burn' and status = 'confirmed'`;
log("11. supply before/after burn", { supplyBefore, supplyAfter, burned: burn?.amount, matches: burn ? supplyBefore - supplyAfter === BigInt(burn.amount) : false });
process.exit(0);
